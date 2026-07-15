"""Salesforce demo-data driver for Pipeline Factory batch-ingestion demos.

Creates/counts/deletes Account records in the demo org so consecutive workflow
runs visibly ingest new rows (the dashboard's Δrows column). All demo records
are namespaced "PF Demo …" so cleanup can never touch anything else.

Credentials come from the Databricks secret scope (never from disk/args).

Usage:
  python sf_data.py seed  --count 25      # initial dataset before the demo
  python sf_data.py batch --count 5       # mid-demo: new rows for the next run
  python sf_data.py count                 # SOQL count of demo accounts
  python sf_data.py wipe                  # delete ALL 'PF Demo%' accounts
"""

import argparse
import base64
import json
import random
import subprocess
import sys
import urllib.parse
import urllib.request

DBX = r"C:\Users\ankur\AppData\Local\Microsoft\WinGet\Packages\Databricks.DatabricksCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\databricks.exe"
SCOPE = "pipeline_factory"
CONN = "sfdc_sample"
API = "v60.0"

INDUSTRIES = ["Technology", "Banking", "Energy", "Healthcare", "Retail", "Manufacturing", "Media"]
TYPES = ["Customer - Direct", "Customer - Channel", "Prospect", "Other"]


def secret(suffix: str) -> str:
    out = subprocess.run(
        [DBX, "api", "get", f"/api/2.0/secrets/get?scope={SCOPE}&key=sfdc_{CONN}_{suffix}"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        print(f"cannot read secret sfdc_{CONN}_{suffix}: {out.stderr[:200]}")
        sys.exit(1)
    return base64.b64decode(json.loads(out.stdout).get("value", "")).decode()


def login() -> tuple[str, str]:
    """Refresh-token grant → (instance_url, access_token). Writes back rotated tokens."""
    host = secret("login_host") or "login.salesforce.com"
    refresh = secret("refresh_token")
    body = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "client_id": secret("client_id"),
        "client_secret": secret("client_secret"),
        "refresh_token": refresh,
    }).encode()
    req = urllib.request.Request(f"https://{host}/services/oauth2/token", data=body, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            tok = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print(f"login failed ({e.code}): {e.read().decode()[:300]}")
        print("→ run sf_auth.py to refresh the org consent")
        sys.exit(1)
    if tok.get("refresh_token") and tok["refresh_token"] != refresh:
        subprocess.run(
            [DBX, "secrets", "put-secret", SCOPE, f"sfdc_{CONN}_refresh_token", "--string-value", tok["refresh_token"]],
            check=True, capture_output=True,
        )
    return tok["instance_url"], tok["access_token"]


def sf(instance: str, token: str, method: str, path: str, payload: dict | None = None) -> dict:
    req = urllib.request.Request(
        f"{instance}/services/data/{API}{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print(f"SF {method} {path} failed ({e.code}): {e.read().decode()[:400]}")
        sys.exit(1)


def create_accounts(instance: str, token: str, n: int, tag: str) -> None:
    # composite sObject tree API: up to 200 records per call
    records = [
        {
            "attributes": {"type": "Account", "referenceId": f"ref{i}"},
            "Name": f"PF Demo {tag} {i + 1:03d}",
            "Type": random.choice(TYPES),
            "Industry": random.choice(INDUSTRIES),
            "AnnualRevenue": random.randrange(1, 500) * 100_000,
        }
        for i in range(n)
    ]
    res = sf(instance, token, "POST", "/composite/tree/Account", {"records": records})
    if res.get("hasErrors"):
        print(f"partial failure: {json.dumps(res)[:400]}")
        sys.exit(1)
    print(f"created {n} accounts (batch tag: {tag})")


def count(instance: str, token: str) -> int:
    q = urllib.parse.quote("SELECT COUNT() FROM Account WHERE Name LIKE 'PF Demo%'")
    res = sf(instance, token, "GET", f"/query?q={q}")
    return int(res.get("totalSize", 0))


def wipe(instance: str, token: str) -> None:
    for soql, label in [
        ("SELECT Id FROM Account WHERE Name LIKE 'PF Demo%' LIMIT 200", "accounts"),
        ("SELECT Id FROM Lead WHERE LastName LIKE 'PF Demo%' LIMIT 200", "leads"),
        ("SELECT Id FROM Contact WHERE LastName LIKE 'PF Demo%' LIMIT 200", "contacts"),
    ]:
        q = urllib.parse.quote(soql)
        while True:
            res = sf(instance, token, "GET", f"/query?q={q}")
            ids = [r["Id"] for r in res.get("records", [])]
            if not ids:
                break
            sf(instance, token, "DELETE", f"/composite/sobjects?ids={','.join(ids)}&allOrNone=false")
            print(f"deleted {len(ids)} {label}")
    print("all PF Demo records removed (accounts, contacts, leads)")


def create_contacts(instance, token, n, tag):
    """Contacts attached to PF Demo accounts (needed for the contact entity build)."""
    q = urllib.parse.quote("SELECT Id FROM Account WHERE Name LIKE 'PF Demo%' LIMIT 50")
    accts = [r["Id"] for r in sf(instance, token, "GET", f"/query?q={q}").get("records", [])]
    if not accts:
        print("no PF Demo accounts — run seed first")
        sys.exit(1)
    records = [
        {
            "attributes": {"type": "Contact", "referenceId": f"c{i}"},
            "AccountId": accts[i % len(accts)],
            "FirstName": f"Demo{i + 1:02d}",
            "LastName": f"PF Demo {tag} {i + 1:03d}",
            "Email": f"pf.demo.{tag.lower()}.{i + 1}@example.com",
        }
        for i in range(n)
    ]
    res = sf(instance, token, "POST", "/composite/tree/Contact", {"records": records})
    if res.get("hasErrors"):
        print(f"partial failure: {json.dumps(res)[:400]}")
        sys.exit(1)
    print(f"created {n} contacts (tag: {tag})")


def create_leads(instance, token, n, tag):
    records = [
        {
            "attributes": {"type": "Lead", "referenceId": f"l{i}"},
            "FirstName": f"Lead{i + 1:02d}",
            "LastName": f"PF Demo {tag} {i + 1:03d}",
            "Company": f"PF Demo {random.choice(INDUSTRIES)} Co {i + 1:02d}",
            "Status": "Open - Not Contacted",
            "Email": f"pf.lead.{tag.lower()}.{i + 1}@example.com",
        }
        for i in range(n)
    ]
    res = sf(instance, token, "POST", "/composite/tree/Lead", {"records": records})
    if res.get("hasErrors"):
        print(f"partial failure: {json.dumps(res)[:400]}")
        sys.exit(1)
    print(f"created {n} leads (tag: {tag})")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=["seed", "batch", "count", "wipe", "seed-contacts", "seed-leads"])
    p.add_argument("--count", type=int, default=25, dest="n")
    p.add_argument("--tag", default="")
    args = p.parse_args()

    instance, token = login()
    if args.action == "seed-contacts":
        create_contacts(instance, token, args.n if args.n != 25 else 15, args.tag or "Seed")
        return
    if args.action == "seed-leads":
        create_leads(instance, token, args.n if args.n != 25 else 20, args.tag or "Seed")
        return
    if args.action == "count":
        print(f"PF Demo accounts in org: {count(instance, token)}")
    elif args.action == "wipe":
        wipe(instance, token)
    else:
        tag = args.tag or ("Seed" if args.action == "seed" else f"Batch{random.randrange(100, 999)}")
        n = args.n if args.action == "seed" or args.n != 25 else 5
        create_accounts(instance, token, n, tag)
        print(f"total now: {count(instance, token)}")


if __name__ == "__main__":
    main()
