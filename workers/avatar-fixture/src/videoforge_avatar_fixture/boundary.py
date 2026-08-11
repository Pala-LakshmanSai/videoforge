from __future__ import annotations

import copy
import hashlib
import json
import re
import struct
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Final, Literal
from urllib.parse import urlsplit

_SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_TIMESTAMP = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$")
_MP4_SIGNATURE: Final[bytes] = struct.pack(">I", 24) + b"ftypisom" + b"\x00\x00\x02\x00isomiso2"
_PAYLOAD_MARKER: Final[bytes] = b"VF-AVATAR-FIXTURE/V1\n"
_EXPECTED_ENVELOPE_KEYS: Final[frozenset[str]] = frozenset(
    {
        "schema_version",
        "job_type",
        "dispatch_target",
        "idempotency_key",
        "workspace_id",
        "project_id",
        "revision_id",
        "task_id",
        "attempt_id",
        "execution_profile_id",
        "execution_claim_token",
        "revision_config",
        "input_manifest",
        "output_prefix",
        "callback",
        "cancel_token",
        "deadline_at",
    }
)
_EXPECTED_MANIFEST_KEYS: Final[frozenset[str]] = frozenset(
    {
        "schema_version",
        "workspace_id",
        "project_id",
        "revision_id",
        "task_id",
        "attempt_id",
        "retry_index",
        "avatar_binding",
        "span_audio",
        "layout",
        "source_profile",
        "crop_profile",
        "rate_profile",
    }
)
_EXPECTED_AVATAR_KEYS: Final[frozenset[str]] = frozenset(
    {
        "avatar_profile_id",
        "avatar_profile_version_id",
        "avatar_profile_hash",
        "runtime_source_asset_id",
        "runtime_source_sha256",
        "runtime_source_mime_type",
        "runtime_source_width",
        "runtime_source_height",
        "source_preparation_version",
        "source_validation_profile_version",
    }
)
_EXPECTED_AUDIO_KEYS: Final[frozenset[str]] = frozenset(
    {
        "asset_id",
        "sha256",
        "sample_rate_hz",
        "channels",
        "padded_duration_samples",
        "trim_start_sample",
        "trim_end_sample_exclusive",
        "source_start_ms",
        "source_end_ms",
    }
)


class BoundaryError(ValueError):
    """Safe validation error whose message never includes untrusted values."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class IdempotencyConflictError(BoundaryError):
    def __init__(self) -> None:
        super().__init__("IDEMPOTENCY_CONFLICT", "idempotency key was reused with changed input")


class CallbackReplayError(BoundaryError):
    def __init__(self) -> None:
        super().__init__("CALLBACK_REPLAY", "callback identity was reused with changed input")


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def _read_manifest_bytes(data: bytes) -> dict[str, Any]:
    def reject_constant(value: str) -> None:
        raise BoundaryError("MANIFEST_BYTES_INVALID", "non-finite JSON is invalid")

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise BoundaryError("MANIFEST_BYTES_INVALID", "duplicate JSON keys are invalid")
            result[key] = value
        return result

    try:
        parsed = json.loads(
            data,
            object_pairs_hook=reject_duplicates,
            parse_constant=reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BoundaryError("MANIFEST_BYTES_INVALID", "manifest JSON is invalid") from error
    if type(parsed) is not dict:
        raise BoundaryError("MANIFEST_BYTES_INVALID", "manifest JSON must be an object")
    return parsed


def _digest(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _expect_bytes(value: Any, code: str) -> bytes:
    if type(value) is not bytes:
        raise BoundaryError(code, "binary input is invalid")
    return value


def _expect_object(value: Any, keys: frozenset[str], code: str) -> dict[str, Any]:
    if type(value) is not dict or set(value) != keys:
        raise BoundaryError(code, "object shape is invalid")
    return value


def _expect_string(value: Any, code: str, *, maximum: int = 160) -> str:
    if type(value) is not str or not value or len(value) > maximum:
        raise BoundaryError(code, "string value is invalid")
    return value


def _expect_id(value: Any, code: str) -> str:
    result = _expect_string(value, code)
    if _ID.fullmatch(result) is None:
        raise BoundaryError(code, "identifier is invalid")
    return result


def _expect_sha256(value: Any, code: str) -> str:
    result = _expect_string(value, code, maximum=71)
    if _SHA256.fullmatch(result) is None:
        raise BoundaryError(code, "SHA-256 value is invalid")
    return result


def _expect_int(value: Any, code: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise BoundaryError(code, "integer value is invalid")
    return value


def _expect_timestamp(value: Any, code: str) -> str:
    result = _expect_string(value, code, maximum=40)
    if _TIMESTAMP.fullmatch(result) is None:
        raise BoundaryError(code, "timestamp is invalid")
    return result


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.removesuffix("Z") + "+00:00")


def _expect_pointer(value: Any, code: str, *, local_manifest: bool = False) -> dict[str, Any]:
    expected = {"asset_id", "sha256"}
    if local_manifest:
        expected.add("artifact_uri")
    pointer = _expect_object(value, frozenset(expected), code)
    _expect_id(pointer["asset_id"], code)
    checksum = _expect_sha256(pointer["sha256"], code)
    if local_manifest:
        uri = _expect_string(pointer["artifact_uri"], code, maximum=300)
        digest = checksum.removeprefix("sha256:")
        expected_uri = f"vf-local://objects/sha256/{digest[:2]}/{digest}.json"
        if uri != expected_uri:
            raise BoundaryError(code, "local manifest pointer does not match its checksum")
    return pointer


def _expected_output_prefix(envelope: dict[str, Any]) -> str:
    return (
        f"workspace/{envelope['workspace_id']}/project/{envelope['project_id']}/"
        f"revision/{envelope['revision_id']}/avatar/primary/{envelope['attempt_id']}/"
    )


def _validate_envelope(value: Any) -> dict[str, Any]:
    envelope = _expect_object(value, _EXPECTED_ENVELOPE_KEYS, "ENVELOPE_INVALID")
    if envelope["schema_version"] != "worker-job-envelope/v1":
        raise BoundaryError("ENVELOPE_INVALID", "worker envelope version is invalid")
    if envelope["job_type"] != "AVATAR_PRIMARY_CHUNK":
        raise BoundaryError("JOB_TYPE_INVALID", "fixture worker accepts only primary Avatar jobs")
    if envelope["dispatch_target"] != "FIXTURE":
        raise BoundaryError("DISPATCH_TARGET_INVALID", "fixture worker accepts only FIXTURE jobs")
    _expect_string(envelope["idempotency_key"], "ENVELOPE_INVALID", maximum=240)
    for key in ("workspace_id", "project_id", "revision_id", "task_id", "attempt_id"):
        _expect_id(envelope[key], "ENVELOPE_INVALID")
    if envelope["execution_profile_id"] != "fixture-avatar-primary-v1":
        raise BoundaryError("EXECUTION_PROFILE_INVALID", "execution profile is invalid")
    if len(_expect_string(envelope["execution_claim_token"], "ENVELOPE_INVALID", maximum=512)) < 32:
        raise BoundaryError("ENVELOPE_INVALID", "execution claim token is invalid")
    if len(_expect_string(envelope["cancel_token"], "ENVELOPE_INVALID", maximum=512)) < 32:
        raise BoundaryError("ENVELOPE_INVALID", "cancel token is invalid")
    _expect_pointer(envelope["revision_config"], "REVISION_POINTER_INVALID")
    _expect_pointer(envelope["input_manifest"], "MANIFEST_POINTER_INVALID", local_manifest=True)
    _expect_timestamp(envelope["deadline_at"], "ENVELOPE_INVALID")
    if envelope["output_prefix"] != _expected_output_prefix(envelope):
        raise BoundaryError("OUTPUT_PREFIX_INVALID", "output prefix is not attempt scoped")
    callback = envelope["callback"]
    if callback is not None:
        callback = _expect_object(
            callback, frozenset({"url", "token", "expires_at"}), "CALLBACK_INVALID"
        )
        url = _expect_string(callback["url"], "CALLBACK_INVALID", maximum=2000)
        try:
            parsed_url = urlsplit(url)
            valid_port = parsed_url.port is None or 1 <= parsed_url.port <= 65_535
        except ValueError as error:
            raise BoundaryError("CALLBACK_INVALID", "callback URL is invalid") from error
        if (
            parsed_url.scheme != "https"
            or not parsed_url.hostname
            or parsed_url.username is not None
            or parsed_url.password is not None
            or parsed_url.fragment
            or not valid_port
        ):
            raise BoundaryError("CALLBACK_INVALID", "callback URL is invalid")
        if len(_expect_string(callback["token"], "CALLBACK_INVALID", maximum=512)) < 32:
            raise BoundaryError("CALLBACK_INVALID", "callback token is invalid")
        _expect_timestamp(callback["expires_at"], "CALLBACK_INVALID")
        if _parse_timestamp(callback["expires_at"]) < _parse_timestamp(envelope["deadline_at"]):
            raise BoundaryError("CALLBACK_INVALID", "callback expires before the job deadline")
    return envelope


def _validate_manifest(value: Any, envelope: dict[str, Any]) -> dict[str, Any]:
    manifest = _expect_object(value, _EXPECTED_MANIFEST_KEYS, "MANIFEST_INVALID")
    if manifest["schema_version"] != "avatar-fixture-job-input/v1":
        raise BoundaryError("MANIFEST_INVALID", "Avatar fixture manifest version is invalid")
    for key in ("workspace_id", "project_id", "revision_id", "task_id", "attempt_id"):
        _expect_id(manifest[key], "MANIFEST_INVALID")
        if manifest[key] != envelope[key]:
            raise BoundaryError("IDENTITY_MISMATCH", "manifest identity differs from the envelope")
    _expect_int(manifest["retry_index"], "RETRY_INVALID")

    avatar = _expect_object(manifest["avatar_binding"], _EXPECTED_AVATAR_KEYS, "AVATAR_INVALID")
    for key in (
        "avatar_profile_id",
        "avatar_profile_version_id",
        "runtime_source_asset_id",
        "source_preparation_version",
        "source_validation_profile_version",
    ):
        _expect_id(avatar[key], "AVATAR_INVALID")
    _expect_sha256(avatar["avatar_profile_hash"], "AVATAR_INVALID")
    _expect_sha256(avatar["runtime_source_sha256"], "AVATAR_INVALID")
    if avatar["runtime_source_mime_type"] not in {"image/jpeg", "image/png", "image/webp"}:
        raise BoundaryError("AVATAR_INVALID", "runtime source media type is invalid")
    _expect_int(avatar["runtime_source_width"], "AVATAR_INVALID", minimum=512)
    _expect_int(avatar["runtime_source_height"], "AVATAR_INVALID", minimum=512)

    audio = _expect_object(manifest["span_audio"], _EXPECTED_AUDIO_KEYS, "SPAN_AUDIO_INVALID")
    _expect_id(audio["asset_id"], "SPAN_AUDIO_INVALID")
    _expect_sha256(audio["sha256"], "SPAN_AUDIO_INVALID")
    if audio["sample_rate_hz"] != 48_000 or audio["channels"] != 1:
        raise BoundaryError("SPAN_AUDIO_INVALID", "span audio must be 48 kHz mono PCM")
    padded_samples = _expect_int(audio["padded_duration_samples"], "SPAN_AUDIO_INVALID", minimum=1)
    trim_start = _expect_int(audio["trim_start_sample"], "SPAN_AUDIO_INVALID")
    trim_end = _expect_int(audio["trim_end_sample_exclusive"], "SPAN_AUDIO_INVALID", minimum=1)
    if not 0 <= trim_start < trim_end <= padded_samples:
        raise BoundaryError("SPAN_AUDIO_INVALID", "span trim range is invalid")
    trimmed_samples = trim_end - trim_start
    if trimmed_samples % 1_920 != 0:
        raise BoundaryError("FRAME_CADENCE_INVALID", "trimmed span is not exact at 25 fps")
    if not 96_000 <= trimmed_samples <= 336_000:
        raise BoundaryError("SPAN_DURATION_INVALID", "trimmed Avatar span must be 2 to 7 seconds")
    start_ms = _expect_int(audio["source_start_ms"], "SPAN_AUDIO_INVALID")
    end_ms = _expect_int(audio["source_end_ms"], "SPAN_AUDIO_INVALID", minimum=1)
    if end_ms <= start_ms or (end_ms - start_ms) * 48 != trimmed_samples:
        raise BoundaryError("AUDIO_BINDING_INVALID", "source duration differs from trimmed audio")

    if manifest["source_profile"] != "avatarforcing-centered-832x480p25-v1":
        raise BoundaryError("SOURCE_PROFILE_INVALID", "Avatar source profile is invalid")
    if manifest["rate_profile"] != "native-25-to-renderer-30-round-near-v1":
        raise BoundaryError("RATE_PROFILE_INVALID", "Avatar rate profile is invalid")
    layout = manifest["layout"]
    expected_crop = {
        "AVATAR_FULL": "832:468:0:6",
        "AVATAR_SPLIT_IMAGE": "416:468:208:6",
    }.get(layout)
    if expected_crop is None or manifest["crop_profile"] != expected_crop:
        raise BoundaryError("LAYOUT_CROP_INVALID", "layout and crop profile do not match")
    return manifest


def _callback_identity(envelope: dict[str, Any]) -> str:
    callback = envelope["callback"]
    if callback is None:
        return _digest(b"fixture-local-null-callback/v1")
    safe = {
        "url": callback["url"],
        "token_sha256": _digest(callback["token"].encode("utf-8")),
        "expires_at": callback["expires_at"],
    }
    return _digest(_canonical_bytes(safe))


def _fixture_media(manifest: dict[str, Any]) -> bytes:
    avatar = manifest["avatar_binding"]
    audio = manifest["span_audio"]
    media_document = {
        "schema_version": "avatar-fixture-media/v1",
        "fixture_non_production": True,
        "avatar_profile_version_id": avatar["avatar_profile_version_id"],
        "avatar_profile_hash": avatar["avatar_profile_hash"],
        "runtime_source_asset_id": avatar["runtime_source_asset_id"],
        "runtime_source_sha256": avatar["runtime_source_sha256"],
        "span_audio_asset_id": audio["asset_id"],
        "span_audio_sha256": audio["sha256"],
        "trim_start_sample": audio["trim_start_sample"],
        "trim_end_sample_exclusive": audio["trim_end_sample_exclusive"],
        "width": 832,
        "height": 480,
        "fps_num": 25,
        "fps_den": 1,
        "frame_count": (audio["trim_end_sample_exclusive"] - audio["trim_start_sample"]) // 1_920,
        "video_codec": "synthetic-fixture",
        "audio_binding": "original-materialized-trimmed-span",
    }
    return _MP4_SIGNATURE + _PAYLOAD_MARKER + _canonical_bytes(media_document)


def _parse_fixture_media(media: bytes) -> dict[str, Any]:
    if not media.startswith(_MP4_SIGNATURE + _PAYLOAD_MARKER):
        raise BoundaryError("MEDIA_SIGNATURE_INVALID", "fixture media signature is invalid")
    payload = media[len(_MP4_SIGNATURE + _PAYLOAD_MARKER) :]
    try:
        decoded = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BoundaryError("MEDIA_PAYLOAD_INVALID", "fixture media payload is invalid") from error
    if type(decoded) is not dict:
        raise BoundaryError("MEDIA_PAYLOAD_INVALID", "fixture media payload is invalid")
    return decoded


def validate_result_media(media: bytes, result: dict[str, Any]) -> None:
    facts = _parse_fixture_media(media)
    expected = result["media"]
    if _digest(media) != expected["sha256"] or len(media) != expected["bytes"]:
        raise BoundaryError("MEDIA_CHECKSUM_INVALID", "fixture media checksum is invalid")
    for key in ("width", "height", "fps_num", "fps_den", "frame_count"):
        if facts.get(key) != expected[key]:
            raise BoundaryError("MEDIA_FACTS_INVALID", "fixture media facts are invalid")
    lineage = result["lineage"]
    for key in (
        "avatar_profile_version_id",
        "avatar_profile_hash",
        "runtime_source_asset_id",
        "runtime_source_sha256",
        "span_audio_asset_id",
        "span_audio_sha256",
    ):
        if facts.get(key) != lineage[key]:
            raise BoundaryError("MEDIA_LINEAGE_INVALID", "fixture media lineage is invalid")


@dataclass
class FixtureLedger:
    """In-memory fixture ledger; it performs no I/O and holds no secret-bearing result fields."""

    cancellations: set[str] = field(default_factory=set)
    executions: dict[tuple[str, str], tuple[str, bytes, bytes]] = field(default_factory=dict)
    attempts: dict[tuple[str, str], tuple[str, str]] = field(default_factory=dict)
    callbacks: dict[tuple[str, str], bytes] = field(default_factory=dict)

    def cancel(self, cancel_token: str) -> None:
        if len(_expect_string(cancel_token, "CANCEL_TOKEN_INVALID", maximum=512)) < 32:
            raise BoundaryError("CANCEL_TOKEN_INVALID", "cancel token is invalid")
        self.cancellations.add(_digest(cancel_token.encode("utf-8")))

    def is_cancelled(self, cancel_token: str) -> bool:
        return _digest(cancel_token.encode("utf-8")) in self.cancellations

    def accept_callback(self, callback: Any) -> Literal["ACCEPTED", "REPLAY"]:
        expected = frozenset(
            {
                "schema_version",
                "callback_event_id",
                "workspace_id",
                "task_id",
                "attempt_id",
                "status",
                "result_sha256",
                "callback_identity_sha256",
            }
        )
        value = _expect_object(callback, expected, "CALLBACK_INVALID")
        if value["schema_version"] != "avatar-fixture-callback/v1":
            raise BoundaryError("CALLBACK_INVALID", "callback version is invalid")
        for key in ("callback_event_id", "workspace_id", "task_id", "attempt_id"):
            _expect_id(value[key], "CALLBACK_INVALID")
        if value["status"] != "SUCCEEDED":
            raise BoundaryError("CALLBACK_INVALID", "callback status is invalid")
        _expect_sha256(value["result_sha256"], "CALLBACK_INVALID")
        _expect_sha256(value["callback_identity_sha256"], "CALLBACK_INVALID")
        canonical = _canonical_bytes(value)
        key = (value["workspace_id"], value["callback_event_id"])
        existing = self.callbacks.get(key)
        if existing is not None:
            if existing != canonical:
                raise CallbackReplayError()
            return "REPLAY"
        execution_key = self.attempts.get((value["workspace_id"], value["attempt_id"]))
        execution = self.executions.get(execution_key) if execution_key is not None else None
        if execution is None:
            raise BoundaryError("CALLBACK_UNKNOWN_ATTEMPT", "callback attempt is unknown")
        _, stored_result, _ = execution
        parsed_result = json.loads(stored_result)
        if (
            parsed_result["identity"]["workspace_id"] != value["workspace_id"]
            or parsed_result["identity"]["task_id"] != value["task_id"]
            or parsed_result["result_sha256"] != value["result_sha256"]
            or parsed_result["callback"]["identity_sha256"] != value["callback_identity_sha256"]
        ):
            raise BoundaryError("CALLBACK_IDENTITY_MISMATCH", "callback lineage is invalid")
        self.callbacks[key] = canonical
        return "ACCEPTED"


class FixtureAvatarWorker:
    def __init__(self, ledger: FixtureLedger | None = None) -> None:
        self.ledger = ledger or FixtureLedger()

    def execute(
        self,
        envelope_value: Any,
        manifest_value: Any,
        *,
        input_manifest_bytes: bytes,
        runtime_source_bytes: bytes,
        span_audio_bytes: bytes,
    ) -> dict[str, Any]:
        """Execute one fixture job without a process, shell, network, provider, GPU, or callback."""
        input_manifest_bytes = _expect_bytes(input_manifest_bytes, "MANIFEST_BYTES_INVALID")
        runtime_source_bytes = _expect_bytes(runtime_source_bytes, "SOURCE_BYTES_INVALID")
        span_audio_bytes = _expect_bytes(span_audio_bytes, "SPAN_BYTES_INVALID")
        envelope_for_fingerprint = copy.deepcopy(envelope_value)
        manifest_for_fingerprint = copy.deepcopy(manifest_value)
        fingerprint = _digest(
            _canonical_bytes(
                {
                    "envelope": envelope_for_fingerprint,
                    "manifest": manifest_for_fingerprint,
                    "input_manifest_bytes_sha256": _digest(input_manifest_bytes),
                    "runtime_source_sha256": _digest(runtime_source_bytes),
                    "span_audio_sha256": _digest(span_audio_bytes),
                }
            )
        )
        idempotency_key = (
            envelope_value.get("idempotency_key")
            if type(envelope_value) is dict and type(envelope_value.get("idempotency_key")) is str
            else "invalid-envelope"
        )
        workspace_key = (
            envelope_value.get("workspace_id")
            if type(envelope_value) is dict and type(envelope_value.get("workspace_id")) is str
            else "invalid-workspace"
        )
        execution_key = (workspace_key, idempotency_key)
        existing = self.ledger.executions.get(execution_key)
        if existing is not None:
            prior_fingerprint, result_bytes, media = existing
            if prior_fingerprint != fingerprint:
                raise IdempotencyConflictError()
            replay = json.loads(result_bytes)
            replay["attempt"]["replayed"] = True
            if replay["status"] == "SUCCEEDED":
                replay["media_bytes"] = media
            return replay

        try:
            envelope = _validate_envelope(envelope_value)
            if _digest(input_manifest_bytes) != envelope["input_manifest"]["sha256"]:
                raise BoundaryError(
                    "MANIFEST_POINTER_MISMATCH", "manifest bytes differ from the dispatch pointer"
                )
            parsed_manifest = _read_manifest_bytes(input_manifest_bytes)
            if parsed_manifest != manifest_value:
                raise BoundaryError(
                    "MANIFEST_BYTES_MISMATCH", "parsed manifest differs from the supplied document"
                )
            manifest = _validate_manifest(manifest_value, envelope)
            avatar = manifest["avatar_binding"]
            audio = manifest["span_audio"]
            if _digest(runtime_source_bytes) != avatar["runtime_source_sha256"]:
                raise BoundaryError("SOURCE_CHECKSUM_MISMATCH", "runtime source bytes are invalid")
            if _digest(span_audio_bytes) != audio["sha256"]:
                raise BoundaryError("SPAN_CHECKSUM_MISMATCH", "span audio bytes are invalid")
            if self.ledger.is_cancelled(envelope["cancel_token"]):
                return self._terminal_record(
                    envelope,
                    manifest,
                    fingerprint=fingerprint,
                    status="CANCELLED",
                    error_code="CANCELLED",
                )
            media = _fixture_media(manifest)
            result = self._success_record(envelope, manifest, media)
            canonical_result = _canonical_bytes(result)
            self.ledger.executions[execution_key] = (fingerprint, canonical_result, media)
            self.ledger.attempts[(envelope["workspace_id"], envelope["attempt_id"])] = execution_key
            delivered = copy.deepcopy(result)
            delivered["media_bytes"] = media
            validate_result_media(media, delivered)
            return delivered
        except BoundaryError as error:
            if isinstance(error, IdempotencyConflictError | CallbackReplayError):
                raise
            envelope = envelope_value if type(envelope_value) is dict else {}
            manifest = manifest_value if type(manifest_value) is dict else {}
            return self._terminal_record(
                envelope,
                manifest,
                fingerprint=fingerprint,
                status="REJECTED",
                error_code=error.code,
            )

    def _terminal_record(
        self,
        envelope: dict[str, Any],
        manifest: dict[str, Any],
        *,
        fingerprint: str,
        status: Literal["REJECTED", "CANCELLED"],
        error_code: str,
    ) -> dict[str, Any]:
        idempotency_key = (
            envelope.get("idempotency_key")
            if type(envelope.get("idempotency_key")) is str
            else "invalid-envelope"
        )
        workspace_id = (
            envelope.get("workspace_id")
            if type(envelope.get("workspace_id")) is str
            else "invalid-workspace"
        )
        attempt_id = (
            envelope.get("attempt_id")
            if type(envelope.get("attempt_id")) is str
            else "invalid-attempt"
        )
        record = {
            "schema_version": "avatar-fixture-result/v1",
            "fixture_non_production": True,
            "status": status,
            "error": {"code": error_code, "safe_message": "fixture job did not produce media"},
            "identity": {
                "workspace_id": envelope.get("workspace_id"),
                "project_id": envelope.get("project_id"),
                "revision_id": envelope.get("revision_id"),
                "task_id": envelope.get("task_id"),
                "attempt_id": attempt_id,
            },
            "attempt": {
                "retry_index": manifest.get("retry_index"),
                "replayed": False,
                "outbound_activity_count": 0,
            },
            "cost": {
                "owner_type": "PROJECT_REVISION",
                "owner_id": envelope.get("revision_id"),
                "estimated_micro_usd": 0,
                "reported_micro_usd": 0,
                "settled_micro_usd": 0,
            },
            "review": {
                "technical_status": "NOT_PRODUCED",
                "subjective_classification": "UNCLASSIFIED",
            },
            "callback": {"delivery_status": "NOT_SENT_FIXTURE"},
        }
        canonical = _canonical_bytes(record)
        execution_key = (workspace_id, idempotency_key)
        self.ledger.executions[execution_key] = (fingerprint, canonical, b"")
        if type(workspace_id) is str and type(attempt_id) is str:
            self.ledger.attempts[(workspace_id, attempt_id)] = execution_key
        return copy.deepcopy(record)

    @staticmethod
    def _success_record(
        envelope: dict[str, Any], manifest: dict[str, Any], media: bytes
    ) -> dict[str, Any]:
        avatar = manifest["avatar_binding"]
        audio = manifest["span_audio"]
        frame_count = (audio["trim_end_sample_exclusive"] - audio["trim_start_sample"]) // 1_920
        identity = {
            "workspace_id": envelope["workspace_id"],
            "project_id": envelope["project_id"],
            "revision_id": envelope["revision_id"],
            "task_id": envelope["task_id"],
            "attempt_id": envelope["attempt_id"],
        }
        lineage = {
            "avatar_profile_id": avatar["avatar_profile_id"],
            "avatar_profile_version_id": avatar["avatar_profile_version_id"],
            "avatar_profile_hash": avatar["avatar_profile_hash"],
            "runtime_source_asset_id": avatar["runtime_source_asset_id"],
            "runtime_source_sha256": avatar["runtime_source_sha256"],
            "source_preparation_version": avatar["source_preparation_version"],
            "source_validation_profile_version": avatar["source_validation_profile_version"],
            "span_audio_asset_id": audio["asset_id"],
            "span_audio_sha256": audio["sha256"],
            "source_start_ms": audio["source_start_ms"],
            "source_end_ms": audio["source_end_ms"],
            "trim_start_sample": audio["trim_start_sample"],
            "trim_end_sample_exclusive": audio["trim_end_sample_exclusive"],
        }
        callback_identity = _callback_identity(envelope)
        result: dict[str, Any] = {
            "schema_version": "avatar-fixture-result/v1",
            "fixture_non_production": True,
            "status": "SUCCEEDED",
            "identity": identity,
            "lineage": lineage,
            "renderer_binding": {
                "layout": manifest["layout"],
                "source_profile": manifest["source_profile"],
                "crop_profile": manifest["crop_profile"],
                "rate_profile": manifest["rate_profile"],
            },
            "media": {
                "sha256": _digest(media),
                "bytes": len(media),
                "signature": "ISO_BMFF_FTYP_ISOM",
                "width": 832,
                "height": 480,
                "fps_num": 25,
                "fps_den": 1,
                "frame_count": frame_count,
                "duration_ms": audio["source_end_ms"] - audio["source_start_ms"],
                "audio_binding_sha256": audio["sha256"],
            },
            "attempt": {
                "retry_index": manifest["retry_index"],
                "replayed": False,
                "outbound_activity_count": 0,
            },
            "cost": {
                "owner_type": "PROJECT_REVISION",
                "owner_id": envelope["revision_id"],
                "estimated_micro_usd": 0,
                "reported_micro_usd": 0,
                "settled_micro_usd": 0,
            },
            "review": {
                "technical_status": "PASS",
                "subjective_classification": "UNCLASSIFIED",
                "allowed_subjective_classifications": [
                    "LIP_ONLY",
                    "WHOLE_FRAME",
                    "ACCEPTED_BY_REVIEWER",
                ],
            },
            "callback": {
                "identity_sha256": callback_identity,
                "delivery_status": "NOT_SENT_FIXTURE",
            },
        }
        result_without_hash = copy.deepcopy(result)
        result["result_sha256"] = _digest(_canonical_bytes(result_without_hash))
        event_suffix = hashlib.sha256(envelope["attempt_id"].encode()).hexdigest()[:24]
        result["callback"]["event"] = {
            "schema_version": "avatar-fixture-callback/v1",
            "callback_event_id": f"callback_{event_suffix}",
            **identity,
            "status": "SUCCEEDED",
            "result_sha256": result["result_sha256"],
            "callback_identity_sha256": callback_identity,
        }
        del result["callback"]["event"]["project_id"]
        del result["callback"]["event"]["revision_id"]
        return result
