"""Salesforce refresh-token bootstrap for the Pipeline Factory demo.

Runs the OAuth authorization-code flow against the demo org's Connected App and
writes the resulting refresh token into the Databricks secret scope that the
factory (discovery, drift_check) and the demo data scripts read from. Tokens
live only in memory and the secret scope — never on disk.

Prereqs:
  - Connected App in the SF org with OAuth enabled, scopes `api refresh_token`,
    and callback URL exactly matching --callback (default http://localhost:8787/callback).
  - client_id/client_secret already present in the scope (sf_auth reads them),
    or passed via --client-id/--client-secret for first-time setup.

Usage:
  python sf_auth.py                # browser flow, updates refresh token secret
  python sf_auth.py --check        # just test the current refresh token
"""

import argparse
import base64
import http.server
import json
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import webbrowser

DBX = r"C:\Users\ankur\AppData\Local\Microsoft\WinGet\Packages\Databricks.DatabricksCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\databricks.exe"
SCOPE = "pipeline_factory"
CONN = "sfdc_sample"  # secret key prefix: sfdc_{CONN}_{suffix}


def secret_get(suffix: str) -> str:
    out = subprocess.run(
        [DBX, "api", "get", f"/api/2.0/secrets/get?scope={SCOPE}&key=sfdc_{CONN}_{suffix}"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return ""
    return base64.b64decode(json.loads(out.stdout).get("value", "")).decode()


def secret_put(suffix: str, value: str) -> None:
    subprocess.run(
        [DBX, "secrets", "put-secret", SCOPE, f"sfdc_{CONN}_{suffix}", "--string-value", value],
        check=True, capture_output=True, text=True,
    )


def token_request(login_host: str, form: dict) -> dict:
    body = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(f"https://{login_host}/services/oauth2/token", data=body, method="POST")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print(f"token request failed ({e.code}): {e.read().decode()[:300]}")
        sys.exit(1)


def check(login_host: str, client_id: str, client_secret: str) -> None:
    tok = token_request(login_host, {
        "grant_type": "refresh_token",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": secret_get("refresh_token"),
    })
    print(f"refresh token OK — instance {tok.get('instance_url')}")
    if tok.get("refresh_token"):
        secret_put("refresh_token", tok["refresh_token"])
        print("(org rotates tokens — rotated value written back to the scope)")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--callback", default="http://localhost:8787/callback")
    p.add_argument("--client-id", default="")
    p.add_argument("--client-secret", default="")
    p.add_argument("--login-host", default="")
    p.add_argument("--check", action="store_true", help="only verify the stored refresh token")
    args = p.parse_args()

    login_host = args.login_host or secret_get("login_host") or "login.salesforce.com"
    client_id = args.client_id or secret_get("client_id")
    client_secret = args.client_secret or secret_get("client_secret")
    if not client_id or not client_secret:
        print("no client_id/client_secret in scope — pass --client-id/--client-secret once")
        sys.exit(1)

    if args.check:
        check(login_host, client_id, client_secret)
        return

    # 1. browser consent
    auth_url = (
        f"https://{login_host}/services/oauth2/authorize?"
        + urllib.parse.urlencode({
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": args.callback,
            "scope": "api refresh_token",
            "prompt": "login consent",
        })
    )
    code_holder: dict = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code_holder["code"] = (q.get("code") or [""])[0]
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Pipeline Factory: auth complete, return to the terminal.")

        def log_message(self, *_):
            pass

    port = int(urllib.parse.urlparse(args.callback).port or 80)
    srv = http.server.HTTPServer(("localhost", port), Handler)
    threading.Thread(target=srv.handle_request, daemon=True).start()
    print("opening browser for Salesforce consent…")
    webbrowser.open(auth_url)
    print(f"(if no browser: open this URL manually)\n{auth_url}\n")
    while "code" not in code_holder:
        pass
    srv.server_close()

    # 2. exchange code → tokens
    tok = token_request(login_host, {
        "grant_type": "authorization_code",
        "code": code_holder["code"],
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": args.callback,
    })
    if "refresh_token" not in tok:
        print(f"no refresh_token in response — enable 'refresh_token' scope on the Connected App. Got: {list(tok)}")
        sys.exit(1)

    # 3. persist to the scope (the sanctioned credential store)
    secret_put("refresh_token", tok["refresh_token"])
    if args.client_id:
        secret_put("client_id", client_id)
    if args.client_secret:
        secret_put("client_secret", client_secret)
    secret_put("instance_url", tok.get("instance_url", ""))
    secret_put("login_host", login_host)
    print(f"refresh token stored in scope '{SCOPE}' — instance {tok.get('instance_url')}")
    print("verify: python sf_auth.py --check")


if __name__ == "__main__":
    main()
