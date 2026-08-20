"""Publish already-derived Mage OCI blobs without rebuilding or repacking.

The default mode is validation only and performs no network access.  Passing
``--publish`` is the sole mutation switch.  The publisher uploads exactly the
``config.json`` and ``layer.tar.gz`` bytes produced by
``build_mage_oci_overlay.py`` and then PUTs the exact ``manifest.json`` bytes;
it never invokes Docker or rewrites a manifest.  Existing tags are rejected to
keep the image reference immutable by policy.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Mapping


DOCKER_MANIFEST_MEDIA_TYPE = "application/vnd.docker.distribution.manifest.v2+json"
DOCKER_CONFIG_MEDIA_TYPE = "application/vnd.docker.container.image.v1+json"
DOCKER_LAYER_MEDIA_TYPE = "application/vnd.docker.image.rootfs.diff.tar.gzip"
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
REPOSITORY = re.compile(r"^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+$")
TAG = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")


class PublishError(ValueError):
    """Raised when an artifact or registry response is unsafe."""


def _sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise PublishError(f"{label} is not readable JSON") from exc
    if not isinstance(value, dict):
        raise PublishError(f"{label} must be a JSON object")
    return value


def _digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise PublishError(f"{label} is not a valid sha256 digest")
    return value


def _validate_artifacts(output_dir: Path) -> dict[str, Any]:
    identity = _read_json(output_dir / "identity.json", "overlay identity")
    manifest_bytes = (output_dir / "manifest.json").read_bytes()
    config_bytes = (output_dir / "config.json").read_bytes()
    layer_bytes = (output_dir / "layer.tar.gz").read_bytes()
    manifest = _read_json(output_dir / "manifest.json", "overlay manifest")
    if _sha256(manifest_bytes) != _digest(identity.get("manifest_digest"), "identity manifest digest"):
        raise PublishError("manifest bytes do not match identity digest")
    if manifest.get("schemaVersion") != 2 or manifest.get("mediaType") != DOCKER_MANIFEST_MEDIA_TYPE:
        raise PublishError("overlay manifest is not Docker schema-2")
    config = manifest.get("config")
    layers = manifest.get("layers")
    if not isinstance(config, dict) or not isinstance(layers, list) or not layers:
        raise PublishError("overlay manifest is missing config or layers")
    config_digest = _digest(config.get("digest"), "manifest config digest")
    layer = layers[-1]
    if not isinstance(layer, dict):
        raise PublishError("overlay manifest final layer is invalid")
    layer_digest = _digest(layer.get("digest"), "manifest layer digest")
    if config.get("mediaType") != DOCKER_CONFIG_MEDIA_TYPE:
        raise PublishError("overlay config media type is invalid")
    if layer.get("mediaType") != DOCKER_LAYER_MEDIA_TYPE:
        raise PublishError("overlay layer media type is invalid")
    if config.get("size") != len(config_bytes) or _sha256(config_bytes) != config_digest:
        raise PublishError("config bytes do not match manifest descriptor")
    if layer.get("size") != len(layer_bytes) or _sha256(layer_bytes) != layer_digest:
        raise PublishError("layer bytes do not match manifest descriptor")
    if _digest(identity.get("config_digest"), "identity config digest") != config_digest:
        raise PublishError("identity config digest does not match manifest")
    if _digest(identity.get("layer_digest"), "identity layer digest") != layer_digest:
        raise PublishError("identity layer digest does not match manifest")
    parent_image = identity.get("parent_image")
    if not isinstance(parent_image, str) or "@sha256:" not in parent_image:
        raise PublishError("identity parent image is not immutable")
    return {
        "identity": identity,
        "manifest": manifest,
        "manifest_bytes": manifest_bytes,
        "config_bytes": config_bytes,
        "layer_bytes": layer_bytes,
        "config_digest": config_digest,
        "layer_digest": layer_digest,
        "manifest_digest": _sha256(manifest_bytes),
    }


class RegistryClient:
    def __init__(self, *, host: str, repository: str, token: str):
        self.host = host
        self.repository = repository
        self.token = token

    def _url(self, path: str) -> str:
        encoded = "/".join(urllib.parse.quote(part, safe="@:") for part in path.split("/"))
        return f"https://{self.host}/v2/{self.repository}/{encoded}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: bytes = b"",
        content_type: str | None = None,
        accept: str | None = None,
    ) -> tuple[int, Mapping[str, str], bytes]:
        return self._request_url(
            method,
            self._url(path),
            body=body,
            content_type=content_type,
            accept=accept,
        )

    def _request_url(
        self,
        method: str,
        url: str,
        *,
        body: bytes = b"",
        content_type: str | None = None,
        accept: str | None = None,
    ) -> tuple[int, Mapping[str, str], bytes]:
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != self.host:
            raise PublishError("registry returned an unexpected upload host")
        request = urllib.request.Request(url, data=body or None, method=method)
        request.add_header("Authorization", f"Bearer {self.token}")
        if content_type:
            request.add_header("Content-Type", content_type)
        if accept:
            request.add_header("Accept", accept)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, dict(response.headers.items()), response.read()
        except urllib.error.HTTPError as exc:
            # Do not print or propagate response bodies: registry errors can
            # echo authorization context supplied by a proxy or service.
            raise PublishError(f"registry {method} request failed with HTTP {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise PublishError(f"registry {method} request could not complete") from exc

    def _blob_exists(self, digest: str) -> bool:
        try:
            status, _headers, _body = self._request("HEAD", f"blobs/{digest}")
        except PublishError as exc:
            if "HTTP 404" in str(exc):
                return False
            raise
        return status == 200

    def _upload_blob(self, digest: str, body: bytes) -> None:
        if _sha256(body) != digest:
            raise PublishError("refusing to upload bytes with a mismatched digest")
        if self._blob_exists(digest):
            return
        status, headers, _body = self._request("POST", "blobs/uploads/")
        if status != 202:
            raise PublishError("registry did not accept blob upload start")
        location = headers.get("Location")
        if not location:
            raise PublishError("registry upload start omitted Location")
        if not urllib.parse.urlparse(location).scheme:
            location = urllib.parse.urljoin(self._url(""), location)
        separator = "&" if "?" in location else "?"
        location = f"{location}{separator}digest={urllib.parse.quote(digest, safe=':')}"
        status, response_headers, _body = self._request_url("PUT", location, body=body)
        if status != 201:
            raise PublishError("registry did not complete blob upload")
        returned_digest = response_headers.get("Docker-Content-Digest")
        if returned_digest and returned_digest != digest:
            raise PublishError("registry returned a different blob digest")

    def publish(self, *, tag: str, artifacts: Mapping[str, Any]) -> dict[str, str]:
        try:
            status, _headers, _body = self._request(
                "HEAD",
                f"manifests/{tag}",
                accept=DOCKER_MANIFEST_MEDIA_TYPE,
            )
        except PublishError as exc:
            if "HTTP 404" not in str(exc):
                raise
            status = 404
        if status != 404:
            raise PublishError("refusing to overwrite an existing image tag")
        self._upload_blob(artifacts["config_digest"], artifacts["config_bytes"])
        self._upload_blob(artifacts["layer_digest"], artifacts["layer_bytes"])
        status, headers, _body = self._request(
            "PUT",
            f"manifests/{tag}",
            body=artifacts["manifest_bytes"],
            content_type=DOCKER_MANIFEST_MEDIA_TYPE,
            accept=DOCKER_MANIFEST_MEDIA_TYPE,
        )
        if status != 201:
            raise PublishError("registry did not accept the image manifest")
        returned_digest = headers.get("Docker-Content-Digest")
        if returned_digest and returned_digest != artifacts["manifest_digest"]:
            raise PublishError("registry returned a different manifest digest")
        status, readback_headers, readback = self._request(
            "GET",
            f"manifests/{tag}",
            accept=DOCKER_MANIFEST_MEDIA_TYPE,
        )
        if status != 200 or _sha256(readback) != artifacts["manifest_digest"]:
            raise PublishError("registry manifest readback did not preserve exact bytes")
        readback_digest = readback_headers.get("Docker-Content-Digest")
        if readback_digest and readback_digest != artifacts["manifest_digest"]:
            raise PublishError("registry manifest readback digest mismatch")
        return {"tag": tag, "manifest_digest": artifacts["manifest_digest"]}


def _registry_token(*, host: str, repository: str, actor: str, secret: str) -> str:
    credentials = base64.b64encode(f"{actor}:{secret}".encode("utf-8")).decode("ascii")
    query = urllib.parse.urlencode(
        {"service": host, "scope": f"repository:{repository}:pull,push"}
    )
    request = urllib.request.Request(f"https://{host}/token?{query}")
    request.add_header("Authorization", f"Basic {credentials}")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            value = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        raise PublishError("registry token exchange failed") from exc
    token = value.get("token") if isinstance(value, dict) else None
    if not isinstance(token, str) or not token:
        raise PublishError("registry token exchange omitted token")
    return token


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--registry-host", default="ghcr.io")
    parser.add_argument("--token-env", default="GHCR_TOKEN")
    parser.add_argument("--actor-env", default="GITHUB_ACTOR")
    parser.add_argument(
        "--publish",
        action="store_true",
        help="perform the exact blob and manifest publication; default is validation only",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not REPOSITORY.fullmatch(args.repository):
        raise PublishError("repository must be a simple registry repository path")
    if not TAG.fullmatch(args.tag):
        raise PublishError("tag contains unsupported characters")
    artifacts = _validate_artifacts(args.output_dir)
    result: dict[str, Any] = {
        "publication_requested": bool(args.publish),
        "manifest_digest": artifacts["manifest_digest"],
        "config_digest": artifacts["config_digest"],
        "layer_digest": artifacts["layer_digest"],
        "repository": args.repository,
        "tag": args.tag,
    }
    if args.publish:
        secret = os.environ.get(args.token_env)
        actor = os.environ.get(args.actor_env)
        if not secret or not actor:
            raise PublishError("publication requires the configured token and actor environment")
        token = _registry_token(
            host=args.registry_host,
            repository=args.repository,
            actor=actor,
            secret=secret,
        )
        result.update(
            RegistryClient(
                host=args.registry_host,
                repository=args.repository,
                token=token,
            ).publish(tag=args.tag, artifacts=artifacts)
        )
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PublishError as exc:
        raise SystemExit(f"mage OCI overlay publication refused: {exc}") from exc
