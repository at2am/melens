"""Upload an Android App Bundle to a Google Play track through the Android Publisher API.

The access token (scope androidpublisher) comes from PLAY_ACCESS_TOKEN. The release workflow mints it
for melens-github-release through Workload Identity Federation, so no service account key exists; that
identity must be a Play Console user with release rights on the app (README.md, One-time setup).
"""

import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications"


def call(token, method, url, body=None, content_type="application/json"):
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    request = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": content_type})
    try:
        with urllib.request.urlopen(request, timeout=900) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:2000]
        raise SystemExit(f"{method} {url.split('?')[0]}: HTTP {error.code} {detail}") from None
    return json.loads(payload) if payload else {}


def upload(token, package, bundle, track, status, release_name):
    edit = call(token, "POST", f"{API}/{package}/edits", {})["id"]
    edit_url = f"{API}/{package}/edits/{edit}"
    try:
        uploaded = call(token, "POST", f"{UPLOAD_API}/{package}/edits/{edit}/bundles?uploadType=media",
                        bundle.read_bytes(), "application/octet-stream")
        version_code = uploaded["versionCode"]
        call(token, "PUT", f"{edit_url}/tracks/{track}", {"track": track, "releases": [
            {"name": release_name, "versionCodes": [str(version_code)], "status": status}]})
        call(token, "POST", f"{edit_url}:commit")
    except BaseException:
        # An uncommitted edit would block the next upload until it expires.
        try:
            call(token, "DELETE", edit_url)
        except SystemExit:
            pass
        raise
    return version_code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", default="com.at2am.melens")
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--track", default="internal")
    # A Play app that has never been rolled out accepts only draft releases.
    parser.add_argument("--status", choices=("completed", "draft"), default="completed")
    parser.add_argument("--release-name", required=True)
    args = parser.parse_args()
    token = os.environ.get("PLAY_ACCESS_TOKEN", "")
    if not token:
        parser.error("PLAY_ACCESS_TOKEN is not set")
    if not args.bundle.is_file():
        parser.error(f"No such bundle: {args.bundle}")
    version_code = upload(token, args.package, args.bundle, args.track, args.status, args.release_name)
    print(json.dumps({"package": args.package, "track": args.track, "status": args.status,
                      "versionCode": version_code, "releaseName": args.release_name}))


if __name__ == "__main__":
    main()
