"""Set up the release Mac's iOS signing keychain, once.

The runner's LaunchAgent creates a security session of its own, and in it the login keychain stays
locked even while the Mac user is logged in, so codesign fails with errSecInternalComponent. The iOS
release job signs from ~/Library/Keychains/melens-signing.keychain-db instead and unlocks it with the
password in ~/.melens-release/ios/keychain-password.

--apply creates that keychain and a new private key, has App Store Connect issue an Apple Development
certificate for it with the API key in ~/.melens-release/ios (README.md, Mobile apps), and imports both
so codesign uses the key without asking. The certificate's id goes to signing-certificate.json, for
revoking it in App Store Connect. Without --apply it only checks the keychain. No secret is printed.
"""

import argparse
import base64
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

KEYS = Path.home() / ".melens-release" / "ios"
KEYCHAIN = Path.home() / "Library" / "Keychains" / "melens-signing.keychain-db"
PASSWORD = KEYS / "keychain-password"
RECORD = KEYS / "signing-certificate.json"
TEAM = "ZF5UMMPVX9"
API = "https://api.appstoreconnect.apple.com/v1"
OPENSSL = "/usr/bin/openssl"


def run(*args, data=None):
    return subprocess.run(args, input=data, capture_output=True, check=True).stdout


def api_token():
    settings = dict(line.split("=", 1) for line in (KEYS / "app-store-connect.env").read_text().split())
    key_id, issuer = settings["ASC_KEY_ID"], settings["ASC_ISSUER_ID"]
    encode = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=")
    now = int(time.time())
    message = (encode(json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}).encode()) + b"."
               + encode(json.dumps({"iss": issuer, "iat": now, "exp": now + 600,
                                    "aud": "appstoreconnect-v1"}).encode()))
    der = run(OPENSSL, "dgst", "-sha256", "-sign", str(KEYS / f"AuthKey_{key_id}.p8"), data=message)
    # openssl signs in DER; a JWT carries r and s as two 32-byte integers.
    offset = 3 if der[1] & 0x80 else 2
    parts = []
    for _ in range(2):
        length = der[offset + 1]
        parts.append(der[offset + 2:offset + 2 + length].lstrip(b"\0").rjust(32, b"\0"))
        offset += 2 + length
    return (message + b"." + encode(b"".join(parts))).decode()


def issue_certificate(csr_pem):
    body = {"data": {"type": "certificates", "attributes": {
        "certificateType": "DEVELOPMENT", "csrContent": csr_pem.decode()}}}
    request = urllib.request.Request(f"{API}/certificates", data=json.dumps(body).encode(), method="POST",
                                     headers={"Authorization": f"Bearer {api_token()}",
                                              "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            certificate = json.load(response)["data"]
    except urllib.error.HTTPError as error:
        raise SystemExit(f"App Store Connect: HTTP {error.code} {error.read().decode('utf-8', 'replace')[:1000]}")
    return certificate["id"], certificate["attributes"]


def identities():
    listing = run("security", "find-identity", "-v", "-p", "codesigning", str(KEYCHAIN)).decode()
    return [line.split()[1] for line in listing.splitlines() if "Apple Development" in line]


def apply():
    if KEYCHAIN.exists():
        raise SystemExit(f"{KEYCHAIN} exists; delete it with `security delete-keychain` to start again.")
    password = secrets.token_urlsafe(32)
    PASSWORD.touch(mode=0o600)
    PASSWORD.write_text(password)
    run("security", "create-keychain", "-p", password, str(KEYCHAIN))
    # Locks after an hour unused and when the Mac sleeps; each release job unlocks it.
    run("security", "set-keychain-settings", "-lut", "3600", str(KEYCHAIN))
    with tempfile.TemporaryDirectory() as work:
        key, cert = Path(work) / "key.pem", Path(work) / "cert.cer"
        run(OPENSSL, "genrsa", "-out", str(key), "2048")
        csr = run(OPENSSL, "req", "-new", "-key", str(key), "-subj", f"/CN=melens release Mac/OU={TEAM}")
        certificate_id, attributes = issue_certificate(csr)
        cert.write_bytes(base64.b64decode(attributes["certificateContent"]))
        run("security", "import", str(key), "-k", str(KEYCHAIN), "-t", "priv", "-f", "openssl",
            "-T", "/usr/bin/codesign")
        run("security", "import", str(cert), "-k", str(KEYCHAIN))
    # So codesign uses the key without asking.
    run("security", "set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, str(KEYCHAIN))
    RECORD.touch(mode=0o600)
    RECORD.write_text(json.dumps({"id": certificate_id, "name": attributes.get("name"),
                                  "serialNumber": attributes.get("serialNumber"),
                                  "expirationDate": attributes.get("expirationDate")}, indent=2) + "\n")
    print(f"Created {KEYCHAIN.name} with certificate {certificate_id} "
          f"({attributes.get('name')}, expires {attributes.get('expirationDate')})")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="Create the keychain and its certificate.")
    args = parser.parse_args()
    if args.apply:
        apply()
    if not KEYCHAIN.exists() or not PASSWORD.exists():
        sys.exit(f"Missing {KEYCHAIN} or {PASSWORD}; run with --apply.")
    run("security", "unlock-keychain", "-p", PASSWORD.read_text(), str(KEYCHAIN))
    found = identities()
    if not found:
        sys.exit(f"{KEYCHAIN.name} has no valid Apple Development identity.")
    print(f"{KEYCHAIN.name}: Apple Development identity {', '.join(found)}")


if __name__ == "__main__":
    main()
