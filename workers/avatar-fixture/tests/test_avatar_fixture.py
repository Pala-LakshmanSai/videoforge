from __future__ import annotations

import copy
import hashlib
import json
import socket

import pytest

from videoforge_avatar_fixture import (
    CallbackReplayError,
    FixtureAvatarWorker,
    FixtureLedger,
    IdempotencyConflictError,
)
from videoforge_avatar_fixture.boundary import BoundaryError, validate_result_media


def digest(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


class Fixture:
    def __init__(self, *, layout: str = "AVATAR_FULL", attempt: int = 1) -> None:
        self.source = b"owned synthetic centered avatar source"
        self.audio = b"owned synthetic padded span wav"
        attempt_id = f"attempt_avatar_001_{attempt:03d}"
        task_id = "task_avatar_001"
        workspace_id = "workspace_alpha"
        project_id = "project_001"
        revision_id = "revision_001"
        self.envelope = {
            "schema_version": "worker-job-envelope/v1",
            "job_type": "AVATAR_PRIMARY_CHUNK",
            "dispatch_target": "FIXTURE",
            "idempotency_key": f"{revision_id}:avatar:{task_id}:{attempt_id}",
            "workspace_id": workspace_id,
            "project_id": project_id,
            "revision_id": revision_id,
            "task_id": task_id,
            "attempt_id": attempt_id,
            "execution_profile_id": "fixture-avatar-primary-v1",
            "execution_claim_token": (
                f"fixture-execution-claim-token-{attempt:02d}-0000000000000000"
            ),
            "revision_config": {
                "asset_id": "asset_revision_config_001",
                "sha256": f"sha256:{'a' * 64}",
            },
            "input_manifest": {
                "asset_id": "asset_avatar_fixture_manifest_001",
                "sha256": f"sha256:{'0' * 64}",
                "artifact_uri": f"vf-local://objects/sha256/00/{'0' * 64}.json",
            },
            "output_prefix": (
                f"workspace/{workspace_id}/project/{project_id}/revision/{revision_id}/"
                f"avatar/primary/{attempt_id}/"
            ),
            "callback": None,
            "cancel_token": f"fixture-cancel-token-{attempt:02d}-00000000000000000000",
            "deadline_at": "2026-08-11T12:00:00.000Z",
        }
        crop = "832:468:0:6" if layout == "AVATAR_FULL" else "416:468:208:6"
        self.manifest = {
            "schema_version": "avatar-fixture-job-input/v1",
            "workspace_id": workspace_id,
            "project_id": project_id,
            "revision_id": revision_id,
            "task_id": task_id,
            "attempt_id": attempt_id,
            "retry_index": attempt - 1,
            "avatar_binding": {
                "avatar_profile_id": "avatar_profile_001",
                "avatar_profile_version_id": "avatar_profile_version_001",
                "avatar_profile_hash": f"sha256:{'b' * 64}",
                "runtime_source_asset_id": "asset_avatar_runtime_source_001",
                "runtime_source_sha256": digest(self.source),
                "runtime_source_mime_type": "image/png",
                "runtime_source_width": 1024,
                "runtime_source_height": 1024,
                "source_preparation_version": "avatar-source-prep-v1",
                "source_validation_profile_version": "avatar-source-validation-v1",
            },
            "span_audio": {
                "asset_id": "asset_avatar_span_audio_001",
                "sha256": digest(self.audio),
                "sample_rate_hz": 48_000,
                "channels": 1,
                "padded_duration_samples": 192_000,
                "trim_start_sample": 24_000,
                "trim_end_sample_exclusive": 168_000,
                "source_start_ms": 10_000,
                "source_end_ms": 13_000,
            },
            "layout": layout,
            "source_profile": "avatarforcing-centered-832x480p25-v1",
            "crop_profile": crop,
            "rate_profile": "native-25-to-renderer-30-round-near-v1",
        }

        self.seal_manifest()

    def seal_manifest(self) -> None:
        self.manifest_bytes = json.dumps(
            self.manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
        manifest_sha = digest(self.manifest_bytes)
        manifest_digest = manifest_sha.removeprefix("sha256:")
        self.envelope["input_manifest"]["sha256"] = manifest_sha
        self.envelope["input_manifest"]["artifact_uri"] = (
            f"vf-local://objects/sha256/{manifest_digest[:2]}/{manifest_digest}.json"
        )

    def run(self, worker: FixtureAvatarWorker) -> dict[str, object]:
        return worker.execute(
            self.envelope,
            self.manifest,
            input_manifest_bytes=self.manifest_bytes,
            runtime_source_bytes=self.source,
            span_audio_bytes=self.audio,
        )


def test_full_and_split_are_deterministic_and_share_one_native_clip() -> None:
    full = Fixture(layout="AVATAR_FULL")
    split = Fixture(layout="AVATAR_SPLIT_IMAGE")
    split.envelope["idempotency_key"] = "revision_001:avatar:task_avatar_001:split"
    split.envelope["attempt_id"] = "attempt_avatar_split_001"
    split.envelope["output_prefix"] = (
        "workspace/workspace_alpha/project/project_001/revision/revision_001/"
        "avatar/primary/attempt_avatar_split_001/"
    )
    split.manifest["attempt_id"] = "attempt_avatar_split_001"
    split.seal_manifest()
    worker = FixtureAvatarWorker()

    full_result = full.run(worker)
    split_result = split.run(worker)

    assert full_result["status"] == split_result["status"] == "SUCCEEDED"
    assert full_result["media_bytes"] == split_result["media_bytes"]
    assert full_result["media"]["sha256"] == split_result["media"]["sha256"]
    assert full_result["renderer_binding"]["crop_profile"] == "832:468:0:6"
    assert split_result["renderer_binding"]["crop_profile"] == "416:468:208:6"
    assert full_result["media"] == {
        "sha256": full_result["media"]["sha256"],
        "bytes": len(full_result["media_bytes"]),
        "signature": "ISO_BMFF_FTYP_ISOM",
        "width": 832,
        "height": 480,
        "fps_num": 25,
        "fps_den": 1,
        "frame_count": 75,
        "duration_ms": 3000,
        "audio_binding_sha256": digest(full.audio),
    }


def test_exact_replay_is_stable_but_changed_idempotency_input_fails() -> None:
    fixture = Fixture()
    worker = FixtureAvatarWorker()
    first = fixture.run(worker)
    second = fixture.run(worker)
    assert second["attempt"]["replayed"] is True
    assert second["result_sha256"] == first["result_sha256"]
    assert second["media_bytes"] == first["media_bytes"]

    fixture.manifest["layout"] = "AVATAR_SPLIT_IMAGE"
    fixture.manifest["crop_profile"] = "416:468:208:6"
    with pytest.raises(IdempotencyConflictError, match="changed input"):
        fixture.run(worker)


@pytest.mark.parametrize(
    ("mutation", "code"),
    [
        (lambda f: setattr(f, "source", b"tampered source"), "SOURCE_CHECKSUM_MISMATCH"),
        (lambda f: setattr(f, "audio", b"tampered span"), "SPAN_CHECKSUM_MISMATCH"),
        (
            lambda f: f.manifest["avatar_binding"].__setitem__(
                "avatar_profile_hash", f"sha256:{'c' * 64}"
            ),
            "MANIFEST_BYTES_MISMATCH",
        ),
        (
            lambda f: f.manifest["avatar_binding"].__setitem__(
                "runtime_source_asset_id", "asset_wrong_source"
            ),
            "MANIFEST_BYTES_MISMATCH",
        ),
        (
            lambda f: f.manifest["span_audio"].__setitem__("asset_id", "asset_wrong_span"),
            "MANIFEST_BYTES_MISMATCH",
        ),
        (
            lambda f: f.manifest.__setitem__("layout", "IMAGE_FULL"),
            "MANIFEST_BYTES_MISMATCH",
        ),
        (
            lambda f: f.manifest.__setitem__("crop_profile", "416:468:208:6"),
            "MANIFEST_BYTES_MISMATCH",
        ),
    ],
)
def test_tampering_and_wrong_bindings_fail_closed(mutation: object, code: str) -> None:
    fixture = Fixture()
    mutation(fixture)  # type: ignore[operator]
    result = fixture.run(FixtureAvatarWorker())
    assert result["status"] == "REJECTED"
    assert result["error"]["code"] == code
    assert result["attempt"]["outbound_activity_count"] == 0
    assert "media_bytes" not in result


def test_sealed_invalid_layout_and_crop_are_rejected_semantically() -> None:
    invalid_layout = Fixture()
    invalid_layout.manifest["layout"] = "IMAGE_FULL"
    invalid_layout.seal_manifest()
    result = invalid_layout.run(FixtureAvatarWorker())
    assert result["status"] == "REJECTED"
    assert result["error"]["code"] == "LAYOUT_CROP_INVALID"

    invalid_crop = Fixture()
    invalid_crop.manifest["crop_profile"] = "416:468:208:6"
    invalid_crop.seal_manifest()
    result = invalid_crop.run(FixtureAvatarWorker())
    assert result["status"] == "REJECTED"
    assert result["error"]["code"] == "LAYOUT_CROP_INVALID"


def test_cancelled_attempt_produces_no_media_and_retry_is_separate() -> None:
    ledger = FixtureLedger()
    first = Fixture(attempt=1)
    ledger.cancel(first.envelope["cancel_token"])
    cancelled = first.run(FixtureAvatarWorker(ledger))
    assert cancelled["status"] == "CANCELLED"
    assert cancelled["cost"]["settled_micro_usd"] == 0
    assert "media_bytes" not in cancelled
    cancelled_replay = first.run(FixtureAvatarWorker(ledger))
    assert cancelled_replay["attempt"]["replayed"] is True
    assert "media_bytes" not in cancelled_replay

    retry = Fixture(attempt=2)
    succeeded = retry.run(FixtureAvatarWorker(ledger))
    assert succeeded["status"] == "SUCCEEDED"
    assert succeeded["attempt"]["retry_index"] == 1
    assert succeeded["identity"]["task_id"] == cancelled["identity"]["task_id"]


def test_duplicate_callback_is_idempotent_and_changed_replay_is_rejected() -> None:
    ledger = FixtureLedger()
    result = Fixture().run(FixtureAvatarWorker(ledger))
    event = result["callback"]["event"]
    assert ledger.accept_callback(event) == "ACCEPTED"
    assert ledger.accept_callback(copy.deepcopy(event)) == "REPLAY"
    changed = copy.deepcopy(event)
    changed["result_sha256"] = f"sha256:{'f' * 64}"
    with pytest.raises(CallbackReplayError):
        ledger.accept_callback(changed)


def test_remote_callback_is_identity_bound_but_never_sent_or_leaked() -> None:
    fixture = Fixture()
    callback_token = "fixture-callback-token-00000000000000000000001"
    callback_url = "https://callbacks.example.invalid/v1/avatar"
    fixture.envelope["callback"] = {
        "url": callback_url,
        "token": callback_token,
        "expires_at": "2026-08-11T12:05:00Z",
    }
    result = fixture.run(FixtureAvatarWorker())
    encoded = json.dumps({key: value for key, value in result.items() if key != "media_bytes"})
    assert result["status"] == "SUCCEEDED"
    assert result["callback"]["delivery_status"] == "NOT_SENT_FIXTURE"
    assert result["callback"]["identity_sha256"].startswith("sha256:")
    assert callback_token not in encoded
    assert callback_url not in encoded


def test_workspace_isolation_rejects_manifest_and_callback_confusion() -> None:
    fixture = Fixture()
    fixture.manifest["workspace_id"] = "workspace_beta"
    fixture.seal_manifest()
    result = fixture.run(FixtureAvatarWorker())
    assert result["status"] == "REJECTED"
    assert result["error"]["code"] == "IDENTITY_MISMATCH"

    ledger = FixtureLedger()
    valid = Fixture().run(FixtureAvatarWorker(ledger))
    callback = copy.deepcopy(valid["callback"]["event"])
    callback["workspace_id"] = "workspace_beta"
    with pytest.raises(BoundaryError, match="unknown") as error:
        ledger.accept_callback(callback)
    assert error.value.code == "CALLBACK_UNKNOWN_ATTEMPT"


def test_media_validation_rejects_signature_checksum_facts_and_lineage_tampering() -> None:
    fixture = Fixture()
    result = fixture.run(FixtureAvatarWorker())
    media = result["media_bytes"]

    with pytest.raises(BoundaryError, match="signature"):
        validate_result_media(b"not-mp4" + media, result)
    changed_facts = copy.deepcopy(result)
    changed_facts["media"]["width"] = 1280
    with pytest.raises(BoundaryError, match="facts"):
        validate_result_media(media, changed_facts)
    changed_lineage = copy.deepcopy(result)
    changed_lineage["lineage"]["span_audio_sha256"] = f"sha256:{'e' * 64}"
    with pytest.raises(BoundaryError, match="lineage"):
        validate_result_media(media, changed_lineage)


def test_fixture_has_zero_outbound_activity_and_rejects_shell_or_destination_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[object] = []

    def blocked_connect(*args: object, **kwargs: object) -> None:
        calls.append((args, kwargs))
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", blocked_connect)
    fixture = Fixture()
    result = fixture.run(FixtureAvatarWorker())
    assert result["attempt"]["outbound_activity_count"] == 0
    assert result["cost"] == {
        "owner_type": "PROJECT_REVISION",
        "owner_id": "revision_001",
        "estimated_micro_usd": 0,
        "reported_micro_usd": 0,
        "settled_micro_usd": 0,
    }
    assert result["review"]["subjective_classification"] == "UNCLASSIFIED"
    assert calls == []

    fixture = Fixture()
    fixture.manifest["shell_args"] = ["ffmpeg", "-i", "untrusted"]
    fixture.seal_manifest()
    rejected = fixture.run(FixtureAvatarWorker())
    assert rejected["status"] == "REJECTED"
    assert rejected["error"]["code"] == "MANIFEST_INVALID"


def test_result_is_canonical_json_except_separately_returned_media_bytes() -> None:
    result = Fixture().run(FixtureAvatarWorker())
    media = result.pop("media_bytes")
    encoded = json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    assert json.loads(encoded)["schema_version"] == "avatar-fixture-result/v1"
    assert media[4:8] == b"ftyp"
