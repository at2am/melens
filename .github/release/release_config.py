"""Write a release configuration for the Web or the mobile apps.

The platform's keys come as JSON on stdin (its Secret Manager secret, or a local app config when
bootstrap.sh seeds that secret). Everything else is fixed for a production release or comes from
the live Cloud Run services. Values are never printed.
"""

import argparse
import json
import os
from pathlib import Path
import sys

PROJECT = "melens-510012"
# The keys each build reads (app/config/example.json); each platform's secret holds only its own.
KEYS = {
    "web": ("FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_WEB_API_KEY", "FIREBASE_WEB_APP_ID",
            "GOOGLE_MAPS_WEB_API_KEY", "GOOGLE_MAPS_MAP_ID"),
    "mobile": ("FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_ANDROID_API_KEY", "FIREBASE_ANDROID_APP_ID",
               "FIREBASE_IOS_API_KEY", "FIREBASE_IOS_APP_ID", "GOOGLE_MAPS_IOS_API_KEY", "GOOGLE_MAPS_MAP_ID"),
}
OPTIONAL = ("GOOGLE_MAPS_MAP_ID",)
LABELS = {"web": "Web", "mobile": "mobile"}


def platform_keys(platform, source):
    label = LABELS[platform]
    try:
        values = json.loads(source)
    except ValueError:
        raise SystemExit(f"The {label} release keys are not valid JSON.") from None
    if not isinstance(values, dict):
        raise SystemExit(f"The {label} release keys must be a JSON object.")
    keys = {key: values.get(key, "") for key in KEYS[platform]}
    if any(not isinstance(value, str) for value in keys.values()):
        raise SystemExit(f"Every {label} release key must be a string.")
    missing = [key for key in KEYS[platform] if key not in OPTIONAL and not keys[key]]
    if missing:
        raise SystemExit(f"Missing {label} release keys: " + ", ".join(missing))
    return keys


def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(value, output, indent=2)
        output.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=sorted(KEYS), default="web")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--keys-only", action="store_true",
                        help="Write only the platform's keys, as stored in its Secret Manager secret.")
    parser.add_argument("--map-base-url")
    parser.add_argument("--agent-base-url")
    args = parser.parse_args()
    keys = platform_keys(args.platform, sys.stdin.read())
    if args.keys_only:
        write_private(args.output, keys)
        return
    if not args.map_base_url or not args.agent_base_url:
        parser.error("--map-base-url and --agent-base-url are required for a release configuration")
    # build_release.py and build_mobile_release.py validate these again, including the HTTPS Cloud Run URL shape.
    write_private(args.output, {
        "MELENS_ENV": "prod", "MAP_DATA_MODE": "live", "FIREBASE_PROJECT_ID": PROJECT,
        "AGENT_DEV_TOKEN": "", "MAP_BASE_URL": args.map_base_url, "AGENT_BASE_URL": args.agent_base_url,
        **keys,
    })


if __name__ == "__main__":
    main()
