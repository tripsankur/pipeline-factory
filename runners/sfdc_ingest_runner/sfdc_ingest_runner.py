"""Salesforce ingestion runner (brnz layer): pulls objects from a Salesforce org
via the REST API and lands them as bronze Delta tables.

Auth: OAuth refresh-token grant, credentials read from a Databricks SECRET SCOPE
(constraint #4 — never in code/params). The app's connect wizard writes:
  {scope}/sfdc_{conn}_client_id
  {scope}/sfdc_{conn}_client_secret
  {scope}/sfdc_{conn}_refresh_token
  {scope}/sfdc_{conn}_instance_url
  {scope}/sfdc_{conn}_login_host

One job run pulls ALL requested objects — the one-batch-per-source standard.
--tables-json: [{"object":"Account","destination":"workspace.bronze.sfdc_account"}, ...]
"""

import argparse
import json
import urllib.parse
import urllib.request

from pyspark.sql import SparkSession


def http_post_form(url, data):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"POST {url} -> {e.code}: {e.read().decode()[:500]}") from None


def http_get(url, token):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GET {url[:120]} -> {e.code}: {e.read().decode()[:500]}") from None


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--secret-scope", required=True)
    p.add_argument("--conn", required=True)
    p.add_argument("--tables-json", required=True)
    p.add_argument("--batch-id", default="brnz_sfdc_batch")
    args = p.parse_args()

    spark = SparkSession.builder.getOrCreate()
    dbutils = __import__("pyspark.dbutils", fromlist=["DBUtils"]).DBUtils(spark)

    def secret(suffix):
        return dbutils.secrets.get(scope=args.secret_scope, key=f"sfdc_{args.conn}_{suffix}")

    login_host = secret("login_host") or "login.salesforce.com"
    # OAuth refresh-token grant -> access token + instance_url
    tok = http_post_form(
        f"https://{login_host}/services/oauth2/token",
        {
            "grant_type": "refresh_token",
            "client_id": secret("client_id"),
            "client_secret": secret("client_secret"),
            "refresh_token": secret("refresh_token"),
        },
    )
    access_token = tok["access_token"]
    instance_url = tok.get("instance_url") or secret("instance_url")

    # Salesforce may ROTATE the refresh token on each grant (issuing a new one and
    # expiring the old). Persist any rotated token back to the secret scope so the
    # next run stays valid — self-healing, no re-consent needed.
    new_rt = tok.get("refresh_token")
    if new_rt:
        try:
            from databricks.sdk import WorkspaceClient

            WorkspaceClient().secrets.put_secret(
                scope=args.secret_scope, key=f"sfdc_{args.conn}_refresh_token", string_value=new_rt
            )
            print("rotated refresh token persisted to secret scope")
        except Exception as e:  # non-fatal: this run still has a valid access token
            print(f"warn: could not persist rotated refresh token: {e}")

    tables = json.loads(args.tables_json)
    results = []
    for t in tables:
        obj, dest = t["object"], t["destination"]

        # discover selectable scalar fields from the object describe (exclude
        # compound/binary types that aren't valid in a flat SOQL SELECT)
        SKIP = {"address", "location", "base64", "complexvalue"}
        desc = http_get(f"{instance_url}/services/data/v60.0/sobjects/{obj}/describe", access_token)
        fields = [
            f["name"]
            for f in desc["fields"]
            if f.get("type") not in SKIP and f.get("calculated") is not True
        ]

        # page through all records via SOQL
        soql = f"SELECT {', '.join(fields)} FROM {obj}"
        url = f"{instance_url}/services/data/v60.0/query?q={urllib.parse.quote(soql)}"
        rows = []
        while url:
            page = http_get(url, access_token)
            for rec in page["records"]:
                rec.pop("attributes", None)
                rows.append({f: (None if rec.get(f) is None else str(rec.get(f))) for f in fields})
            nxt = page.get("nextRecordsUrl")
            url = f"{instance_url}{nxt}" if nxt else None

        # explicit all-STRING schema — never infer (all-null columns break inference)
        schema = ", ".join(f"`{f}` STRING" for f in fields)
        df = spark.createDataFrame(rows, schema=schema)
        df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(dest)
        spark.sql(
            f"""ALTER TABLE {dest} SET TBLPROPERTIES (
                'generated_by' = 'pipeline_factory', 'ingest_batch' = '{args.batch_id}',
                'source_object' = '{obj}')"""
        )
        results.append({"object": obj, "rows": len(rows), "destination": dest})
        print(f"OK {obj}: {len(rows)} rows -> {dest}")

    print(json.dumps({"batch": args.batch_id, "tables": results}))


if __name__ == "__main__":
    main()
