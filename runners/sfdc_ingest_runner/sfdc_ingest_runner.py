"""Salesforce ingestion runner (brnz layer): pulls objects from a Salesforce org
via the REST API (simple-salesforce) and lands them as bronze Delta tables.

Auth comes from a Databricks secret scope (constraint #4 — never in code/params):
  {scope}/instance_url      e.g. https://yourorg-dev-ed.develop.my.salesforce.com
  {scope}/username
  {scope}/password
  {scope}/security_token    (empty string if IP-relaxed / not required)

Tables ride the source's single batch (one job run pulls ALL tables — the
one-batch-per-source standard). --tables-json:
  [{"object": "Account", "fields": ["Id","Name"], "destination": "workspace.bronze.sfdc_account"}]
"""

import argparse
import json

from pyspark.sql import SparkSession
from simple_salesforce import Salesforce


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--secret-scope", required=True)
    p.add_argument("--tables-json", required=True)
    p.add_argument("--batch-id", default="brnz_sfdc_batch")
    args = p.parse_args()

    spark = SparkSession.builder.getOrCreate()
    dbutils = __import__("pyspark.dbutils", fromlist=["DBUtils"]).DBUtils(spark)

    def secret(key: str) -> str:
        return dbutils.secrets.get(scope=args.secret_scope, key=key)

    instance_url = secret("instance_url").rstrip("/")
    sf = Salesforce(
        username=secret("username"),
        password=secret("password"),
        security_token=secret("security_token"),
        instance_url=instance_url,
        domain="login" if ".sandbox." not in instance_url and "test.salesforce" not in instance_url else "test",
    )

    tables = json.loads(args.tables_json)
    results = []
    for t in tables:
        obj, fields, dest = t["object"], t["fields"], t["destination"]
        soql = f"SELECT {', '.join(fields)} FROM {obj}"
        rows = sf.query_all(soql)["records"]
        for r in rows:
            r.pop("attributes", None)
        count = len(rows)
        if count == 0:
            # still (re)create an empty table with string columns so downstream exists
            df = spark.createDataFrame([], schema=" ".join(f"{f} STRING," for f in fields).rstrip(","))
        else:
            df = spark.createDataFrame([{f: (None if r.get(f) is None else str(r.get(f))) for f in fields} for r in rows])
        (
            df.write.mode("overwrite")
            .option("overwriteSchema", "true")
            .saveAsTable(dest)
        )
        spark.sql(
            f"""ALTER TABLE {dest} SET TBLPROPERTIES (
                'generated_by' = 'pipeline_factory',
                'ingest_batch' = '{args.batch_id}',
                'source_object' = '{obj}'
            )"""
        )
        results.append({"object": obj, "rows": count, "destination": dest})
        print(f"✓ {obj}: {count} rows -> {dest}")

    print(json.dumps({"batch": args.batch_id, "tables": results}))


if __name__ == "__main__":
    main()
