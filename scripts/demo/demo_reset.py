"""Reset all Pipeline Factory assets for one source before a demo run-through.

Calls the app's POST /api/ops/demo-reset/{source} (typed confirmation), which
deletes the workflow job, ingestion/ETL pipelines, managed bronze/silver tables,
control-plane + observability rows, and the app registry state for that source.
Framework bundle, UC connections, secret scopes, sync pipelines survive.

Usage:  python demo_reset.py sfdc
"""

import json
import subprocess
import sys
import urllib.request

DBX = r"C:\Users\ankur\AppData\Local\Microsoft\WinGet\Packages\Databricks.DatabricksCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\databricks.exe"
APP = "https://pipeline-factory-7474658437363349.aws.databricksapps.com"
HOST = "https://dbc-5ff279f3-09b2.cloud.databricks.com"


def token() -> str:
    out = subprocess.run([DBX, "auth", "token", "--host", HOST], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)["access_token"]


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--yes"]
    assume_yes = "--yes" in sys.argv
    if len(args) != 1:
        print("usage: python demo_reset.py <source> [--yes]   e.g. python demo_reset.py sfdc --yes")
        sys.exit(1)
    source = args[0]
    if assume_yes:
        answer = f"reset {source}"
    else:
        try:
            answer = input(f"This deletes ALL factory assets for '{source}' (job, pipelines, tables, registry). Type 'reset {source}' to continue: ")
        except EOFError:
            print("non-interactive shell detected - rerun with --yes to confirm")
            sys.exit(1)
    if answer != f"reset {source}":
        print("aborted")
        sys.exit(1)
    req = urllib.request.Request(
        f"{APP}/api/ops/demo-reset/{source}",
        data=json.dumps({"confirm": answer}).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            print(json.dumps(json.loads(r.read().decode()), indent=2))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:2000]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
