"""Identify the exact app source and bundle served by a local browser test."""

import hashlib
import json
import subprocess
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parent
PROVENANCE_VERSION = 2


def bundle_files(directory):
    return {
        path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(directory.rglob("*"))
        if path.is_file() and path.name != "build-provenance.json"
    }


def validate_assets(directory):
    for relative in ("index.html", "main.dart.js", "flutter_bootstrap.js",
                     "assets/AssetManifest.bin", "assets/AssetManifest.bin.json", "assets/FontManifest.json"):
        path = directory / relative
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"The Web build is incomplete: {relative} is missing or empty.")
    assets = (directory / "assets").resolve()
    manifest = json.loads((assets / "FontManifest.json").read_text())
    if not isinstance(manifest, list):
        raise ValueError("The Web font manifest must contain a list of font families.")
    families = set()
    for family in manifest:
        if not isinstance(family, dict) or not isinstance(family.get("family"), str):
            raise ValueError("The Web font manifest contains an invalid family.")
        families.add(family["family"])
        fonts = family.get("fonts")
        if not isinstance(fonts, list) or not fonts:
            raise ValueError(f"The Web font family has no fonts: {family['family']}.")
        for font in fonts:
            asset = font.get("asset") if isinstance(font, dict) else None
            if not isinstance(asset, str):
                raise ValueError("The Web font manifest contains an invalid asset.")
            path = (assets / asset).resolve()
            if not path.is_relative_to(assets) or not path.is_file() or path.stat().st_size == 0:
                raise ValueError(f"The Web font asset is missing or invalid: {asset}.")
    if not {"Roboto", "MaterialIcons"}.issubset(families):
        raise ValueError("The Web font manifest must include Roboto and MaterialIcons.")


def source_stamp():
    digest = hashlib.sha256()
    paths = []
    for name in ("lib", "web", "assets"):
        paths.extend(p for p in (APP / name).rglob("*") if p.is_file())
    paths.extend(APP / name for name in ("pubspec.yaml", "pubspec.lock", "l10n.yaml", ".fvmrc") if (APP / name).is_file())
    for path in sorted(paths):
        digest.update(path.relative_to(APP).as_posix().encode() + b"\0")
        digest.update(path.read_bytes() + b"\0")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    return {"sourceCommit": commit, "appSourceSha256": digest.hexdigest()}


def validate_build(directory, mode):
    manifest_path = directory / "build-provenance.json"
    if not manifest_path.is_file():
        raise ValueError("Build provenance is missing. Run e2e/build.py before serving the app.")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("formatVersion") != PROVENANCE_VERSION:
        raise ValueError("Build provenance is outdated. Rebuild the local E2E application.")
    for key, value in source_stamp().items():
        if manifest.get(key) != value:
            raise ValueError(f"Stale app build: {key} differs from the current source.")
    if manifest.get("dataMode") != mode:
        raise ValueError("The build data mode differs from the server mode.")
    config = APP / "config" / f"local-e2e-{mode}.json"
    if not config.is_file() or hashlib.sha256(config.read_bytes()).hexdigest() != manifest.get("configSha256"):
        raise ValueError("The build configuration differs from its provenance manifest.")
    validate_assets(directory)
    bundle = directory / "main.dart.js"
    if not bundle.is_file() or hashlib.sha256(bundle.read_bytes()).hexdigest() != manifest.get("bundleSha256"):
        raise ValueError("The app bundle does not match its provenance manifest.")
    if bundle_files(directory) != manifest.get("filesSha256"):
        raise ValueError("The Web build files differ from their provenance manifest.")
    return manifest


if __name__ == "__main__":
    print(json.dumps(source_stamp()))
