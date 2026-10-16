"""Build a complete production Web bundle and bind it to reviewed backend revisions."""

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from provenance import APP, bundle_files, source_stamp, validate_assets

PROJECT = "melens-510012"
FORMAT_VERSION = 1
REVISION = re.compile(r"[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")
IMAGE_DIGEST = re.compile(r"(?:[a-z0-9][a-z0-9./_-]*@)?sha256:[0-9a-f]{64}\Z")
BACKEND_FIELDS = ("mapRevision", "agentRevision", "mapImageDigest", "agentImageDigest")


def sha256_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def release_files(directory):
    files = bundle_files(directory)
    files.pop("release-provenance.json", None)
    return files


def cloud_url(value):
    if not isinstance(value, str):
        raise ValueError("Production service URLs must be HTTPS Cloud Run URLs.")
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or parsed.username is not None or parsed.password is not None
            or parsed.port is not None or parsed.query or parsed.fragment or parsed.path not in ("", "/")
            or not parsed.hostname or not re.fullmatch(r"[a-z0-9-]+\.[a-z0-9-]+\.run\.app", parsed.hostname)):
        raise ValueError("Production service URLs must be HTTPS Cloud Run URLs.")
    return value


def release_settings():
    config = APP / "config" / "cloud-release.json"
    ignored = subprocess.run(["git", "check-ignore", "--quiet", str(config)], cwd=APP.parent,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    if ignored.returncode != 0:
        raise ValueError("The production configuration must be an ignored, untracked local file.")
    settings = json.loads(config.read_text())
    if not isinstance(settings, dict) or settings.get("MELENS_ENV") != "prod" or settings.get("MAP_DATA_MODE") != "live":
        raise ValueError("The release configuration must select production and live data.")
    if settings.get("AGENT_DEV_TOKEN") not in (None, ""):
        raise ValueError("Production builds must not contain a development token.")
    if settings.get("FIREBASE_PROJECT_ID") != PROJECT:
        raise ValueError("The release configuration must use the fixed Firebase project.")
    cloud_url(settings.get("MAP_BASE_URL"))
    cloud_url(settings.get("AGENT_BASE_URL"))
    project = json.loads((APP / ".firebaserc").read_text())
    projects = project.get("projects") if isinstance(project, dict) else None
    if not isinstance(projects, dict) or projects.get("default") != PROJECT:
        raise ValueError("The Firebase default project must be melens-510012.")
    firebase = json.loads((APP / "firebase.json").read_text())
    hosting = firebase.get("hosting") if isinstance(firebase, dict) else None
    if not isinstance(hosting, dict) or hosting.get("site", PROJECT) != PROJECT or "target" in hosting:
        raise ValueError("The release must use the fixed Hosting site without a target alias.")
    return config, settings


def backend_identity(values):
    for name in BACKEND_FIELDS:
        pattern = REVISION if name.endswith("Revision") else IMAGE_DIGEST
        if not isinstance(values.get(name), str) or pattern.fullmatch(values[name]) is None:
            raise ValueError(f"Invalid immutable backend identity: {name}.")
    return {name: values[name] for name in BACKEND_FIELDS}


def input_hashes(config):
    return {"configSha256": sha256_file(config), "hostingConfigSha256": sha256_file(APP / "firebase.json"),
            "firebaseProjectSha256": sha256_file(APP / ".firebaserc")}


def validate_release(directory=None):
    directory = Path(directory) if directory is not None else APP / "build" / "web-cloud-release"
    config, settings = release_settings()
    path = directory / "release-provenance.json"
    if not path.is_file():
        raise ValueError("Release provenance is missing. Build the cloud release first.")
    manifest = json.loads(path.read_text())
    if not isinstance(manifest, dict) or manifest.get("formatVersion") != FORMAT_VERSION:
        raise ValueError("Release provenance has an unsupported format.")
    for name, value in {**source_stamp(), **input_hashes(config)}.items():
        if manifest.get(name) != value:
            raise ValueError(f"Stale release: {name} differs from the current workspace.")
    if (manifest.get("dataMode") != "live" or manifest.get("environment") != "prod"
            or manifest.get("mapBaseUrl") != settings["MAP_BASE_URL"]
            or manifest.get("agentBaseUrl") != settings["AGENT_BASE_URL"]):
        raise ValueError("Release provenance does not match the production configuration.")
    backend_identity(manifest)
    validate_assets(directory)
    if sha256_file(directory / "main.dart.js") != manifest.get("bundleSha256"):
        raise ValueError("The release bundle differs from its provenance.")
    if release_files(directory) != manifest.get("filesSha256"):
        raise ValueError("The release files differ from their provenance.")
    return manifest


def build_release(identity):
    identity = backend_identity(identity)
    config, settings = release_settings()
    build_root = APP / "build"
    build_root.mkdir(exist_ok=True)
    with (build_root / ".e2e-build.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        stamp = source_stamp()
        hashes = input_hashes(config)
        generated = build_root / "web"
        if generated.exists():
            shutil.rmtree(generated)
        subprocess.run(["fvm", "flutter", "build", "web", "--release", "--no-web-resources-cdn",
                        f"--dart-define-from-file={config}"], cwd=APP, check=True)
        validate_assets(generated)
        if source_stamp() != stamp or input_hashes(config) != hashes:
            raise ValueError("Source or release configuration changed during compilation. Build again.")
        with TemporaryDirectory(prefix=".web-cloud-release-", dir=build_root) as temporary:
            staged = Path(temporary) / "bundle"
            shutil.copytree(generated, staged)
            manifest = {
                **stamp, **hashes, **identity, "formatVersion": FORMAT_VERSION,
                "environment": "prod", "dataMode": "live",
                "mapBaseUrl": settings["MAP_BASE_URL"], "agentBaseUrl": settings["AGENT_BASE_URL"],
                "bundleSha256": sha256_file(staged / "main.dart.js"), "filesSha256": release_files(staged),
                "builtAt": datetime.now(timezone.utc).isoformat(),
            }
            (staged / "release-provenance.json").write_text(json.dumps(manifest, indent=2) + "\n")
            validate_release(staged)
            output = build_root / "web-cloud-release"
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
    parser.add_argument("--map-revision", required=True)
    parser.add_argument("--agent-revision", required=True)
    parser.add_argument("--map-image-digest", required=True)
    parser.add_argument("--agent-image-digest", required=True)
    args = parser.parse_args()
    try:
        manifest = build_release({"mapRevision": args.map_revision, "agentRevision": args.agent_revision,
                                  "mapImageDigest": args.map_image_digest, "agentImageDigest": args.agent_image_digest})
        print(json.dumps({"built": "web-cloud-release", "sourceCommit": manifest["sourceCommit"],
                          "appSourceSha256": manifest["appSourceSha256"], "bundleSha256": manifest["bundleSha256"]}))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        status = error.returncode if isinstance(error, subprocess.CalledProcessError) else "invalid_release"
        print(json.dumps({"error": "release_build_failed", "status": status}))
        raise SystemExit(1)
