"""Bounded retained-input fixture preparation; no provider calls or public artifacts."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from datetime import datetime, timezone

MAX_BYTES = 512 * 1024**2
SHA = re.compile(r"sha256:[0-9a-f]{64}\Z")


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest()


def https(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Invalid private capability")
    return url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def open_capability(request: urllib.request.Request):
    return urllib.request.build_opener(NoRedirect).open(request, timeout=30)


def validate_plan(plan: dict) -> None:
    source = plan["source"]
    publication = plan["publication"]
    if (plan["schema_version"] != "videoforge-cloud-media-derived-audio-plan/v1"
            or not SHA.fullmatch(plan["expected_image_digest"])
            or not SHA.fullmatch(plan["expected_ffmpeg_sha256"])
            or not SHA.fullmatch(source["sha256"])
            or source["bytes"] != 2_548_151 or source["duration_ms"] != 159_216
            or source["sample_rate"] != 44_100 or source["channels"] != 2
            or plan["cycle_duration_ms"] != 159_200 or plan["target_duration_ms"] != 2_700_000
            or publication["wait_seconds"] != 1800 or publication["maximum_bytes"] != MAX_BYTES
            or not isinstance(publication["object_key"], str)
            or not publication["object_key"] or ".." in publication["object_key"].split("/")):
        raise ValueError("Retained fixture plan differs from authorized facts")
    https(source["url"])
    https(publication["mailbox_url"])


def download(plan: dict, root: Path) -> None:
    target = root / "source.mp3"
    expected = plan["source"]
    with open_capability(urllib.request.Request(https(expected["url"]))) as response, target.open("xb") as output:
        remaining = expected["bytes"]
        while remaining:
            chunk = response.read(min(1024**2, remaining))
            if not chunk:
                raise ValueError("Source download truncated")
            output.write(chunk)
            remaining -= len(chunk)
        if response.read(1):
            raise ValueError("Source download exceeds exact bound")
    if digest(target) != expected["sha256"]:
        raise ValueError("Source checksum differs")


def probe(path: Path, tool: Path) -> dict:
    result = subprocess.run([str(tool), "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
                            capture_output=True, check=True, timeout=30)
    value = json.loads(result.stdout)
    streams = value["streams"]
    if len(streams) != 1 or streams[0]["codec_type"] != "audio":
        raise ValueError("Fixture must contain exactly one audio stream")
    stream = streams[0]
    return {"sample_rate_hz": int(stream["sample_rate"]), "channels": int(stream["channels"]),
            "duration_ms": round(float(value["format"]["duration"]) * 1000),
            "codec_name": stream["codec_name"], "duration_ts": stream.get("duration_ts"),
            "time_base": stream.get("time_base")}


def derive(plan: dict, root: Path) -> dict:
    runtime = json.loads(Path("/opt/videoforge/runtime.json").read_bytes())
    if runtime.get("qualified") is not True or runtime.get("required_cpu_flags") != ["avx", "avx2", "f16c", "fma"]:
        raise ValueError("Fixture requires qualified Linux runtime")
    from videoforge_media_local.runpod_job import _verify_cpu_features
    _verify_cpu_features(runtime["required_cpu_flags"])
    ffmpeg = Path(runtime["tools"]["ffmpeg"]["path"])
    ffprobe = Path(runtime["tools"]["ffprobe"]["path"])
    if digest(ffmpeg) != plan["expected_ffmpeg_sha256"] or digest(ffprobe) != runtime["tools"]["ffprobe"]["sha256"]:
        raise ValueError("Fixture tool identity differs")
    source = root / "source.mp3"
    if source.stat().st_size != plan["source"]["bytes"] or digest(source) != plan["source"]["sha256"]:
        raise ValueError("Fixture source identity differs")
    source_facts = probe(source, ffprobe)
    if (source_facts["sample_rate_hz"] != 44_100 or source_facts["channels"] != 2
            or source_facts["duration_ms"] != plan["source"]["duration_ms"]):
        raise ValueError("Fixture source probe differs")
    target = root / "derived.flac"
    filter_graph = "atrim=end_sample=7020720,asetpts=PTS-STARTPTS,aloop=loop=-1:size=7020720,atrim=end_sample=119070000"
    subprocess.run([str(ffmpeg), "-nostdin", "-v", "error", "-n", "-i", str(source), "-map", "0:a:0",
                    "-af", filter_graph, "-c:a", "flac", "-sample_fmt", "s32", "-fs", str(MAX_BYTES), str(target)],
                   capture_output=True, check=True, timeout=600)
    facts = probe(target, ffprobe)
    if (not 0 < target.stat().st_size < MAX_BYTES or facts["codec_name"] != "flac"
            or facts["duration_ms"] != 2_700_000 or facts["sample_rate_hz"] != 44_100
            or facts["channels"] != 2 or facts["duration_ts"] != 119_070_000
            or facts["time_base"] != "1/44100"):
        raise ValueError("Derived fixture facts differ")
    return {"content_length": target.stat().st_size, "sha256": digest(target), "content_type": "audio/flac",
            "duration_ms": 2_700_000, "sample_rate_hz": 44_100, "channels": 2,
            "source_sha256": plan["source"]["sha256"], "ffmpeg_sha256": plan["expected_ffmpeg_sha256"],
            "image_digest": plan["expected_image_digest"]}


def validate_mailbox(plan: dict, facts: dict, mailbox: dict) -> dict:
    if mailbox.get("schema_version") != "videoforge-private-derived-audio-mailbox/v1":
        raise ValueError("Unexpected private mailbox schema")
    for field in ("content_length", "sha256", "content_type", "duration_ms", "sample_rate_hz", "channels", "source_sha256"):
        if mailbox.get(field) != facts[field]:
            raise ValueError("Private mailbox facts differ")
    url = https(mailbox["put_url"])
    expires = datetime.fromisoformat(mailbox["expires_at"].replace("Z", "+00:00"))
    if expires.tzinfo is None or expires <= datetime.now(timezone.utc):
        raise ValueError("Private upload authority expired")
    path = urllib.parse.unquote(urllib.parse.urlsplit(url).path)
    if not path.endswith("/" + plan["publication"]["object_key"]):
        raise ValueError("Private upload object differs")
    headers = mailbox["headers"]
    lower = {key.lower(): value for key, value in headers.items()}
    checksum = base64.b64encode(bytes.fromhex(facts["sha256"][7:])).decode()
    if (lower.get("content-length") != str(facts["content_length"])
            or lower.get("content-type") != "audio/flac" or lower.get("if-none-match") != "*"
            or lower.get("x-amz-checksum-sha256") != checksum
            or lower.get("x-amz-meta-sha256") not in {facts["sha256"], facts["sha256"][7:]}
            or set(lower) != {"content-length", "content-type", "if-none-match",
                              "x-amz-checksum-sha256", "x-amz-meta-sha256"}):
        raise ValueError("Private upload authority differs")
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    signed = set(query.get("X-Amz-SignedHeaders", query.get("x-amz-signedheaders", [""]))[0].split(";"))
    if not set(lower).issubset(signed):
        raise ValueError("Private upload headers are not signed")
    return headers


def publish(plan: dict, facts: dict, root: Path) -> None:
    target = root / "derived.flac"
    if target.stat().st_size != facts["content_length"] or digest(target) != facts["sha256"]:
        raise ValueError("Derived output changed before publication")
    deadline = time.monotonic() + plan["publication"]["wait_seconds"]
    while time.monotonic() < deadline:
        try:
            with open_capability(urllib.request.Request(https(plan["publication"]["mailbox_url"]))) as response:
                encoded = response.read(16 * 1024 + 1)
                if len(encoded) > 16 * 1024:
                    raise ValueError("Private mailbox exceeds bound")
                mailbox = json.loads(encoded)
            break
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise ValueError("Private mailbox request failed") from None
            time.sleep(min(10, max(0, deadline - time.monotonic())))
    else:
        raise ValueError("Private publication authority was not issued within deadline")
    headers = validate_mailbox(plan, facts, mailbox)
    with target.open("rb") as stream:
        request = urllib.request.Request(mailbox["put_url"], data=stream, headers=headers, method="PUT")
        with open_capability(request) as response:
            if response.status not in (200, 201, 204):
                raise ValueError("Private output publication failed")
    print("Private derived output uploaded; independent whole-object verification remains required")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("download", "derive", "publish"), required=True)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    try:
        plan = json.loads((args.root / "plan.json").read_bytes())
        validate_plan(plan)
        if args.phase == "download":
            download(plan, args.root)
        elif args.phase == "derive":
            facts = derive(plan, args.root)
            (args.root / "facts.json").write_text(json.dumps(facts, sort_keys=True) + "\n")
            print("DERIVED_AUDIO_FACTS " + json.dumps(facts, sort_keys=True), flush=True)
        else:
            publish(plan, json.loads((args.root / "facts.json").read_bytes()), args.root)
        return 0
    except Exception:
        print("Retained audio fixture operation failed; no private capability details logged", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
