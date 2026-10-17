"""Build a signed production Android App Bundle or iOS archive from config/mobile-release.json.

Android signs with the upload key that MELENS_ANDROID_KEY_PROPERTIES names (android/app/build.gradle.kts).
iOS archives with automatic signing for team ZF5UMMPVX9; with ASC_KEY_PATH, ASC_KEY_ID and ASC_ISSUER_ID
set, Xcode uses that App Store Connect API key to fetch or create the signing assets. The release workflow
exports and uploads the archive (.github/release/README.md).
"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess

from build_release import production_settings
from provenance import APP, source_stamp

CONFIG = APP / "config" / "mobile-release.json"
TEAM = "ZF5UMMPVX9"
REQUIRED = {
    "android": ("FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_ANDROID_API_KEY", "FIREBASE_ANDROID_APP_ID"),
    "ios": ("FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_IOS_API_KEY", "FIREBASE_IOS_APP_ID", "GOOGLE_MAPS_IOS_API_KEY"),
}
BUILD_NAME = re.compile(r"(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\Z")
# Google Play's largest versionCode.
MAX_BUILD_NUMBER = 2_100_000_000
AAB = APP / "build" / "app" / "outputs" / "bundle" / "release" / "app-release.aab"
ARCHIVE = APP / "build" / "ios" / "archive" / "Runner.xcarchive"


def mobile_settings(platform):
    settings = production_settings(CONFIG)
    missing = [key for key in REQUIRED[platform] if not isinstance(settings.get(key), str) or not settings[key]]
    if missing:
        raise ValueError(f"The {platform} release configuration is missing: " + ", ".join(missing))
    return settings


def version_args(build_name, build_number):
    if BUILD_NAME.fullmatch(build_name) is None:
        raise ValueError("The build name must be MAJOR.MINOR.PATCH.")
    if not 1 <= build_number <= MAX_BUILD_NUMBER:
        raise ValueError(f"The build number must be between 1 and {MAX_BUILD_NUMBER}.")
    return [f"--build-name={build_name}", f"--build-number={build_number}"]


def build_android(versions):
    key_properties = os.environ.get("MELENS_ANDROID_KEY_PROPERTIES", "")
    if not key_properties or not Path(key_properties).is_file():
        raise ValueError("MELENS_ANDROID_KEY_PROPERTIES must name the upload key's key.properties.")
    if AAB.exists():
        AAB.unlink()
    subprocess.run(["fvm", "flutter", "build", "appbundle", "--release", f"--dart-define-from-file={CONFIG}",
                    *versions], cwd=APP, check=True)
    # Without the key, Gradle would fall back to the debug key, which Play rejects.
    signer = subprocess.run(["keytool", "-printcert", "-jarfile", str(AAB)], capture_output=True, text=True,
                            check=True).stdout
    if "Owner:" not in signer or "CN=Android Debug" in signer:
        raise ValueError("The App Bundle is not signed with the upload key.")
    return AAB


def build_ios(versions):
    subprocess.run(["fvm", "flutter", "build", "ios", "--config-only", "--release",
                    f"--dart-define-from-file={CONFIG}", *versions], cwd=APP, check=True)
    subprocess.run(["pod", "install"], cwd=APP / "ios", check=True)
    signing = ["-allowProvisioningUpdates"]
    key = {name: os.environ.get(name, "") for name in ("ASC_KEY_PATH", "ASC_KEY_ID", "ASC_ISSUER_ID")}
    if all(key.values()):
        signing += [f"-authenticationKeyPath={key['ASC_KEY_PATH']}", f"-authenticationKeyID={key['ASC_KEY_ID']}",
                    f"-authenticationKeyIssuerID={key['ASC_ISSUER_ID']}"]
    elif any(key.values()):
        raise ValueError("Set all of ASC_KEY_PATH, ASC_KEY_ID and ASC_ISSUER_ID, or none.")
    # The Swift packages the workflow resolved into build/ios/SourcePackages; without this the archive
    # resolves again into DerivedData and fetches every package from GitHub.
    packages = ["-clonedSourcePackagesDirPath", str(APP / "build" / "ios" / "SourcePackages"),
                "-skipPackageUpdates", "-onlyUsePackageVersionsFromResolvedFile"]
    subprocess.run(["xcodebuild", "-workspace", "Runner.xcworkspace", "-scheme", "Runner", "-configuration", "Release",
                    "-destination", "generic/platform=iOS", "-archivePath", str(ARCHIVE), *packages, *signing,
                    f"DEVELOPMENT_TEAM={TEAM}", "archive"], cwd=APP / "ios", check=True)
    return ARCHIVE


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=("android", "ios"), required=True)
    parser.add_argument("--build-name", required=True)
    parser.add_argument("--build-number", type=int, required=True)
    args = parser.parse_args()
    try:
        mobile_settings(args.platform)
        versions = version_args(args.build_name, args.build_number)
        stamp = source_stamp()
        output = (build_android if args.platform == "android" else build_ios)(versions)
        if source_stamp() != stamp:
            raise ValueError("Source changed during compilation. Build again.")
        print(json.dumps({"built": args.platform, "output": str(output), "sourceCommit": stamp["sourceCommit"],
                          "buildName": args.build_name, "buildNumber": args.build_number}))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        status = error.returncode if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(json.dumps({"error": "mobile_release_build_failed", "status": status}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
