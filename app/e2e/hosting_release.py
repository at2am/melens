"""Plan, or explicitly publish, the verified Melens Firebase Hosting bundle.

Protocol: https://firebase.google.com/docs/hosting/api-deploy
The default command does not obtain credentials or call a cloud API.
"""

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

from build_release import validate_release
from provenance import APP


PROJECT = "melens-510012"
SITE = "melens-510012"
REGION = "australia-southeast2"
BACKENDS = {"map": "melens-dev-map", "agent": "melens-dev-agent"}
API = "https://firebasehosting.googleapis.com/v1beta1/"
CHANNEL = f"sites/{SITE}/channels/live"
VERSION_PATTERN = re.compile(rf"sites/{SITE}/versions/[A-Za-z0-9_-]+")
RELEASE_PATTERN = re.compile(rf"sites/{SITE}/(?:channels/live/)?releases/[A-Za-z0-9_-]+")
HASH_PATTERN = re.compile(r"[a-f0-9]{64}")
MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024


class ReleaseError(RuntimeError):
    """An error message that contains no response body or credentials."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


class HostingClient:
    def __init__(self, token):
        self._token = token
        self._opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, resource, body=None, upload=None):
        url = API + resource
        if upload is not None:
            url = upload
            parsed = urllib.parse.urlsplit(url)
            if (parsed.scheme != "https" or parsed.netloc != "upload-firebasehosting.googleapis.com"
                    or parsed.query or parsed.fragment
                    or not re.fullmatch(rf"/upload/sites/{SITE}/versions/[A-Za-z0-9_-]+/files/[a-f0-9]{{64}}", parsed.path)):
                raise ReleaseError("The Hosting upload URL is invalid.")
        if upload is not None:
            data = body
        else:
            data = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": "Bearer " + self._token,
            "X-Goog-User-Project": PROJECT,
            "Content-Type": "application/octet-stream" if upload is not None else "application/json",
        })
        try:
            with self._opener.open(request, timeout=120) as response:
                if not 200 <= response.status < 300:
                    raise ReleaseError(f"Hosting request failed with HTTP {response.status}.")
                if upload is not None:
                    return None
                value = json.loads(response.read())
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            raise ReleaseError(f"Hosting request failed with HTTP {status}.") from None
        except (OSError, urllib.error.URLError, ValueError):
            raise ReleaseError("Hosting request failed without a usable response.") from None
        if not isinstance(value, dict):
            raise ReleaseError("Hosting returned an invalid response.")
        return value


def access_token():
    try:
        result = subprocess.run(["gcloud", "auth", "print-access-token"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, timeout=60, check=False)
    except (OSError, subprocess.SubprocessError):
        raise ReleaseError("Access-token retrieval failed.") from None
    if result.returncode != 0:
        raise ReleaseError(f"Access-token retrieval failed with exit status {result.returncode}.")
    token = result.stdout.strip()
    if not token or any(char.isspace() for char in token):
        raise ReleaseError("Access-token retrieval returned an invalid result.")
    return token


def digest(value):
    return hashlib.sha256(value).hexdigest()


def save_evidence(directory, name, value):
    path = directory / name
    temporary = directory / (name + ".tmp")
    with temporary.open("w", encoding="utf-8") as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def checked_release(directory):
    try:
        manifest = validate_release(directory=directory)
    except Exception:
        raise ReleaseError("Release bundle validation failed. Rebuild the cloud release.") from None
    if not isinstance(manifest, dict):
        raise ReleaseError("Release validation returned invalid provenance.")
    return manifest


def serving_config():
    try:
        config_bytes = (APP / "firebase.json").read_bytes()
        hosting = json.loads(config_bytes)["hosting"]
        if (not isinstance(hosting, dict) or set(hosting) - {"public", "ignore", "headers", "rewrites", "site"}
                or hosting.get("site", SITE) != SITE):
            raise ValueError()
        result = {"headers": [], "rewrites": []}
        for rule in hosting.get("headers", []):
            if set(rule) != {"source", "headers"} or not isinstance(rule["source"], str):
                raise ValueError()
            headers = {}
            for header in rule["headers"]:
                if set(header) != {"key", "value"} or not all(isinstance(header[key], str) for key in ("key", "value")):
                    raise ValueError()
                if header["key"].lower() in {key.lower() for key in headers}:
                    raise ValueError()
                headers[header["key"]] = header["value"]
            result["headers"].append({"glob": rule["source"], "headers": headers})
        for rule in hosting.get("rewrites", []):
            if (set(rule) != {"source", "destination"}
                    or not all(isinstance(rule[key], str) for key in ("source", "destination"))
                    or not rule["destination"].startswith("/")):
                raise ValueError()
            result["rewrites"].append({"glob": rule["source"], "path": rule["destination"]})
    except (OSError, ValueError, TypeError, KeyError):
        raise ReleaseError("The Firebase Hosting configuration is invalid or unsupported.") from None
    return result, digest(config_bytes)


def prepare_plan(directory, evidence):
    manifest = checked_release(directory)
    config, config_hash = serving_config()
    if manifest.get("hostingConfigSha256") != config_hash:
        raise ReleaseError("Hosting configuration differs from release provenance.")
    compressed = evidence / "gzip"
    compressed.mkdir(mode=0o700)
    files = {}
    hashes = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ReleaseError("The release bundle must not contain symbolic links.")
        if path.is_dir():
            continue
        if not path.is_file() or path.stat().st_size > MAX_FILE_BYTES:
            raise ReleaseError("The release bundle contains an unsupported file.")
        relative = path.relative_to(directory).as_posix()
        raw = path.read_bytes()
        content = gzip.compress(raw, compresslevel=9, mtime=0)
        gzip_hash = digest(content)
        target = compressed / gzip_hash
        if not target.exists():
            target.write_bytes(content)
        files["/" + relative] = {"sha256": digest(raw), "gzipSha256": gzip_hash,
                                  "bytes": len(raw), "gzipBytes": len(content)}
        hashes[gzip_hash] = target
    if not files:
        raise ReleaseError("The release bundle contains no files.")
    if checked_release(directory) != manifest or serving_config()[1] != config_hash:
        raise ReleaseError("The release inputs changed during the plan. Run the command again.")
    expected = dict(manifest.get("filesSha256", {}))
    expected["release-provenance.json"] = digest((directory / "release-provenance.json").read_bytes())
    if {path[1:]: item["sha256"] for path, item in files.items()} != expected:
        raise ReleaseError("The staged files differ from the verified release bundle.")
    plan = {
        "project": PROJECT, "site": SITE, "directory": str(directory),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "hostingConfigSha256": config_hash, "fileCount": len(files),
        "bytes": sum(item["bytes"] for item in files.values()),
        "gzipBytes": sum(item["gzipBytes"] for item in files.values()),
        "files": files,
    }
    for key in ("sourceCommit", "appSourceSha256", "bundleSha256", "configSha256", "firebaseProjectSha256"):
        value = manifest.get(key)
        if isinstance(value, str) and re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", value):
            plan[key] = value
    save_evidence(evidence, "plan.json", plan)
    return plan, manifest, config, hashes


def version_name(value):
    if not isinstance(value, str) or not VERSION_PATTERN.fullmatch(value):
        raise ReleaseError("Hosting returned an invalid version identifier.")
    return value


def version_metadata(value):
    result = {"name": version_name(value.get("name"))}
    for key in ("status", "createTime", "finalizeTime", "fileCount", "versionBytes"):
        item = value.get(key)
        if isinstance(item, (str, int)) and re.fullmatch(r"[A-Za-z0-9:.+_-]{1,80}", str(item)):
            result[key] = item
    if isinstance(value.get("config"), dict):
        result["configSha256"] = digest(json.dumps(value["config"], sort_keys=True, separators=(",", ":")).encode())
    return result


def release_metadata(value):
    if not isinstance(value, dict):
        raise ReleaseError("Hosting returned invalid live release metadata.")
    name = value.get("name")
    if not isinstance(name, str) or not RELEASE_PATTERN.fullmatch(name):
        raise ReleaseError("Hosting returned an invalid release identifier.")
    result = {"name": name}
    for key in ("type", "releaseTime"):
        item = value.get(key)
        if isinstance(item, str) and re.fullmatch(r"[A-Za-z0-9:.+_-]{1,80}", item):
            result[key] = item
    if value.get("version"):
        result["version"] = version_metadata(value["version"])
    return result


def current_release(client):
    channel = client.request("GET", CHANNEL)
    if channel.get("name") != CHANNEL:
        raise ReleaseError("Hosting returned the wrong channel.")
    release = channel.get("release")
    return release_metadata(release) if release else None


def describe_backend(resource, name, fields):
    try:
        result = subprocess.run([
            "gcloud", "run", resource, "describe", name,
            f"--project={PROJECT}", f"--region={REGION}", f"--format=json({fields})",
        ], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=30, check=False)
    except (OSError, subprocess.SubprocessError):
        raise ReleaseError("Cloud Run backend verification could not complete.") from None
    if result.returncode != 0:
        raise ReleaseError(f"Cloud Run backend verification failed with exit status {result.returncode}.")
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise ReleaseError("Cloud Run backend verification returned invalid metadata.") from None
    if not isinstance(value, dict):
        raise ReleaseError("Cloud Run backend verification returned invalid metadata.")
    return value


def ready_status(status):
    conditions = status.get("conditions")
    return (isinstance(conditions, list)
            and [item.get("status") for item in conditions if isinstance(item, dict)
                 and item.get("type") == "Ready"] == ["True"])


def production_container(spec, expected_image):
    containers = spec.get("containers")
    if (not isinstance(containers, list) or len(containers) != 1
            or not isinstance(containers[0], dict) or containers[0].get("image") != expected_image):
        raise ReleaseError("A Cloud Run backend container differs from the release image.")
    environment = containers[0].get("env", [])
    if not isinstance(environment, list) or any(not isinstance(item, dict) for item in environment):
        raise ReleaseError("A Cloud Run backend has invalid environment metadata.")
    modes = [item for item in environment if item.get("name") == "AGENT_DEVELOPMENT_MODE"]
    if modes and (len(modes) != 1 or set(modes[0]) != {"name", "value"} or modes[0]["value"] != "false"):
        raise ReleaseError("A Cloud Run backend does not prove production mode.")


def backend_proof(manifest):
    proof = {}
    for key, service_name in BACKENDS.items():
        expected_revision = manifest.get(key + "Revision")
        expected_image = manifest.get(key + "ImageDigest")
        expected_url = manifest.get(key + "BaseUrl")
        if (not isinstance(expected_revision, str)
                or not re.fullmatch(re.escape(service_name) + r"-[a-z0-9-]+", expected_revision)
                or len(expected_revision) > 63 or not isinstance(expected_image, str)
                or not re.fullmatch(r"[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}", expected_image)
                or not isinstance(expected_url, str)):
            raise ReleaseError("Release provenance does not contain fixed immutable backend identities.")
        service = describe_backend("services", service_name,
            "metadata.name,metadata.generation,status.url,status.latestReadyRevisionName,"
            "status.latestCreatedRevisionName,status.observedGeneration,status.conditions,status.traffic,"
            "spec.template.metadata.name,spec.template.spec.containers")
        try:
            metadata = service["metadata"]
            status = service["status"]
            template = service["spec"]["template"]
            template_metadata = template.get("metadata", {})
            generation = metadata["generation"]
            traffic = status["traffic"]
            if (metadata.get("name") != service_name or type(generation) is not int
                    or status.get("observedGeneration") != generation or not ready_status(status)
                    or status.get("url") != expected_url
                    or status.get("latestReadyRevisionName") != expected_revision
                    or status.get("latestCreatedRevisionName") != expected_revision
                    or not isinstance(template_metadata, dict)
                    or ("name" in template_metadata and template_metadata["name"] != expected_revision)
                    or not isinstance(traffic, list)
                    or any(not isinstance(item, dict) or type(item.get("percent", 0)) is not int
                           or not 0 <= item.get("percent", 0) <= 100 for item in traffic)):
                raise ReleaseError("A Cloud Run backend no longer matches the release revision or URL.")
            active = [item for item in traffic if item.get("percent", 0) > 0]
            if len(active) != 1 or active[0].get("revisionName") != expected_revision or active[0]["percent"] != 100:
                raise ReleaseError("A Cloud Run backend does not route all traffic to the release revision.")
            production_container(template["spec"], expected_image)
            revision = describe_backend("revisions", expected_revision,
                "metadata.name,metadata.labels,status.imageDigest,status.conditions,spec.containers")
            if (revision["metadata"].get("name") != expected_revision
                    or revision["metadata"].get("labels", {}).get("serving.knative.dev/service") != service_name
                    or not ready_status(revision["status"])
                    or revision["status"].get("imageDigest") != expected_image):
                raise ReleaseError("A Cloud Run revision differs from the release image or is not ready.")
            production_container(revision["spec"], expected_image)
        except (KeyError, TypeError, AttributeError):
            raise ReleaseError("Cloud Run backend verification returned incomplete metadata.") from None
        proof[key] = {"name": service_name, "url": expected_url, "revision": expected_revision,
                      "imageDigest": expected_image, "generation": generation,
                      "trafficPercent": 100, "developmentMode": False}
    return proof


def record_backend_proof(manifest, evidence, stage):
    record = {"project": PROJECT, "region": REGION}
    try:
        proof = backend_proof(manifest)
    except ReleaseError as error:
        save_evidence(evidence, f"backend-{stage}.json", {**record, "status": "rejected", "reason": str(error)})
        raise
    save_evidence(evidence, f"backend-{stage}.json", {**record, "status": "verified", "services": proof})
    return proof


def publish(directory, evidence, plan, manifest, config, hashes):
    client = HostingClient(access_token())
    site = client.request("GET", f"projects/{PROJECT}/sites/{SITE}")
    if not re.fullmatch(rf"projects/(?:{PROJECT}|[0-9]+)/sites/{SITE}", str(site.get("name", ""))):
        raise ReleaseError("Hosting returned the wrong project or site.")
    previous = current_release(client)
    old_version = None
    if previous and previous.get("version"):
        old_version = version_metadata(client.request("GET", previous["version"]["name"]))
        if old_version["name"] != previous["version"]["name"]:
            raise ReleaseError("Hosting returned the wrong previous version.")
    save_evidence(evidence, "before.json", {"project": PROJECT, "site": SITE,
                  "capturedAt": datetime.now(timezone.utc).isoformat(),
                  "release": previous, "version": old_version})
    if checked_release(directory) != manifest or serving_config()[1] != plan["hostingConfigSha256"]:
        raise ReleaseError("The release inputs changed before publication.")
    for compressed_hash, path in hashes.items():
        if digest(path.read_bytes()) != compressed_hash:
            raise ReleaseError("A staged upload changed before publication.")
    backends_before = record_backend_proof(manifest, evidence, "before")
    state = {"phase": "creating-version", "project": PROJECT, "site": SITE,
             "previousVersion": old_version["name"] if old_version else None,
             "previousRelease": previous["name"] if previous else None}
    save_evidence(evidence, "result.json", state)
    created = client.request("POST", f"sites/{SITE}/versions", {"config": config})
    version = version_name(created.get("name"))
    state.update({"phase": "populating-files", "version": version,
                  "versionId": version.rsplit("/", 1)[1]})
    save_evidence(evidence, "result.json", state)
    entries = list(plan["files"].items())
    uploads = {}
    for offset in range(0, len(entries), 1000):
        batch = {path: item["gzipSha256"] for path, item in entries[offset:offset + 1000]}
        response = client.request("POST", version + ":populateFiles", {"files": batch})
        required = response.get("uploadRequiredHashes", [])
        upload_url = response.get("uploadUrl")
        expected_url = "https://upload-firebasehosting.googleapis.com/upload/" + version + "/files"
        if (not isinstance(required, list) or any(not isinstance(item, str) or not HASH_PATTERN.fullmatch(item)
                or item not in batch.values() for item in required)
                or (required and upload_url != expected_url)):
            raise ReleaseError("Hosting returned invalid upload requirements.")
        for required_hash in required:
            uploads[required_hash] = expected_url + "/" + required_hash
    state.update({"phase": "uploading-files", "requiredUploadCount": len(uploads)})
    save_evidence(evidence, "result.json", state)
    for compressed_hash, upload_url in sorted(uploads.items()):
        content = hashes[compressed_hash].read_bytes()
        if digest(content) != compressed_hash:
            raise ReleaseError("A staged upload changed during publication.")
        client.request("POST", "", body=content, upload=upload_url)
    finalized = client.request("PATCH", version + "?updateMask=status", {"status": "FINALIZED"})
    if finalized.get("name") != version or finalized.get("status") != "FINALIZED":
        raise ReleaseError("Hosting did not confirm a finalized version.")
    state.update({"phase": "finalized", "finalizedVersion": version_metadata(finalized)})
    save_evidence(evidence, "result.json", state)
    if current_release(client) != previous:
        raise ReleaseError("The live release changed during publication. The new version remains finalized.")
    if checked_release(directory) != manifest or serving_config()[1] != plan["hostingConfigSha256"]:
        raise ReleaseError("The release inputs changed during upload. The new version remains finalized.")
    if record_backend_proof(manifest, evidence, "after") != backends_before:
        raise ReleaseError("The Cloud Run backends changed during upload. The new version remains finalized.")
    state["phase"] = "release-requested"
    save_evidence(evidence, "result.json", state)
    resource = f"sites/{SITE}/releases?" + urllib.parse.urlencode({"versionName": version})
    released = release_metadata(client.request("POST", resource))
    if released.get("version", {}).get("name") != version:
        raise ReleaseError("Hosting did not confirm the requested release version.")
    state.update({"phase": "released", "release": released})
    save_evidence(evidence, "result.json", state)
    current = current_release(client)
    if not current or current.get("version", {}).get("name") != version:
        raise ReleaseError("Hosting has not confirmed the requested live version. Inspect the saved evidence.")
    state.update({"phase": "live-version-confirmed", "liveRelease": current})
    save_evidence(evidence, "result.json", state)
    return state


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=APP / "build" / "web-cloud-release")
    parser.add_argument("--apply", action="store_true", help="Publish after all local and cloud preflight checks.")
    parser.add_argument("--confirm-project", help="Required with --apply. Must be melens-510012.")
    args = parser.parse_args(argv)
    if args.apply and args.confirm_project != PROJECT:
        parser.error("--apply requires --confirm-project melens-510012")
    if not args.apply and args.confirm_project is not None:
        parser.error("--confirm-project requires --apply")
    evidence = Path(tempfile.mkdtemp(prefix="melens-hosting-release-", dir="/tmp"))
    try:
        directory = args.directory.resolve(strict=True)
        plan, manifest, config, hashes = prepare_plan(directory, evidence)
        summary = {key: plan[key] for key in ("project", "site", "fileCount", "bytes", "gzipBytes")}
        summary.update({"mode": "apply" if args.apply else "plan", "evidenceDirectory": str(evidence)})
        if args.apply:
            result = publish(directory, evidence, plan, manifest, config, hashes)
            summary.update({key: result[key] for key in ("phase", "version", "versionId", "previousVersion")})
        print(json.dumps(summary, sort_keys=True))
        return 0
    except ReleaseError as error:
        print(json.dumps({"error": str(error), "evidenceDirectory": str(evidence)}), file=sys.stderr)
    except Exception:
        print(json.dumps({"error": "Hosting release failed. No response details were logged.",
                          "evidenceDirectory": str(evidence)}), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
