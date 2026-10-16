"""Build a local test app and record its current source identity."""

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory

from provenance import APP, PROVENANCE_VERSION, bundle_files, source_stamp, validate_assets, validate_build


def build_variant(mode):
    config = APP / "config" / f"local-e2e-{mode}.json"
    settings = json.loads(config.read_text())
    if settings.get("MELENS_ENV") != "dev" or settings.get("MAP_DATA_MODE") != mode:
        raise ValueError("Use an explicit development configuration with the matching data mode.")
    build_root = APP / "build"
    build_root.mkdir(exist_ok=True)
    with (build_root / ".e2e-build.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        stamp = source_stamp()
        config_hash = hashlib.sha256(config.read_bytes()).hexdigest()
        generated = build_root / "web"
        # A fresh default output avoids the incomplete custom-output asset bundles.
        # Every final mode directory receives a complete copy of this one build.
        if generated.exists():
            shutil.rmtree(generated)
        subprocess.run([
            "fvm", "flutter", "build", "web", "--no-web-resources-cdn",
            f"--dart-define-from-file={config}",
        ], cwd=APP, check=True)
        validate_assets(generated)
        if source_stamp() != stamp or hashlib.sha256(config.read_bytes()).hexdigest() != config_hash:
            raise ValueError("App source or configuration changed during the build. Build again after edits finish.")
        with TemporaryDirectory(prefix=f".web-e2e-{mode}-", dir=build_root) as temporary:
            staged = Path(temporary) / "bundle"
            shutil.copytree(generated, staged)
            manifest = {
                **stamp, "formatVersion": PROVENANCE_VERSION, "dataMode": mode,
                "configSha256": config_hash, "filesSha256": bundle_files(staged),
                "bundleSha256": hashlib.sha256((staged / "main.dart.js").read_bytes()).hexdigest(),
                "builtAt": datetime.now(timezone.utc).isoformat(),
                "mapBaseUrl": settings.get("MAP_BASE_URL"),
                "agentBaseUrl": settings.get("AGENT_BASE_URL"),
            }
            (staged / "build-provenance.json").write_text(json.dumps(manifest, indent=2) + "\n")
            validate_build(staged, mode)
            output = build_root / f"web-e2e-{mode}"
            previous = Path(temporary) / "previous"
            if output.exists():
                output.rename(previous)
            try:
                staged.rename(output)
            except OSError:
                if previous.exists():
                    previous.rename(output)
                raise
        return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["live", "sample"], required=True)
    args = parser.parse_args()
    manifest = build_variant(args.mode)
    print(json.dumps({"built": args.mode, "appSourceSha256": manifest["appSourceSha256"],
                      "bundleSha256": manifest["bundleSha256"]}))
