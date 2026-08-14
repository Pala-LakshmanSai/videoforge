from __future__ import annotations

import base64
import binascii
import hashlib
from dataclasses import dataclass
from pathlib import Path

from span_contract import EchoSpanJob

MAX_INPUT_BYTES = 24 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class EchoQualificationJob:
    mode: str
    schema_version: str
    project_revision_id: str
    span_id: str
    task_key: str
    attempt_id: str
    timeline_composition: str
    source_base64: str
    source_sha256: str
    span_audio_base64: str
    span_audio_sha256: str
    prompt: str
    selected_start_ms: int
    selected_end_ms_exclusive: int
    padded_start_ms: int
    padded_end_ms_exclusive: int
    trim_start_ms: int
    trim_end_ms_exclusive: int
    audio_sample_rate_hz: int
    audio_channels: int
    full_voiceover_dispatched: bool

    @classmethod
    def from_value(cls, value: object) -> EchoQualificationJob:
        expected = set(cls.__dataclass_fields__)
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError("ECHO_QUALIFICATION_JOB_SHAPE_INVALID")
        job = cls(**value)
        if job.mode != "OWNED_CP07_QUALIFICATION_V1":
            raise ValueError("ECHO_QUALIFICATION_MODE_INVALID")
        job.span_job()
        for encoded in (job.source_base64, job.span_audio_base64):
            if not isinstance(encoded, str) or len(encoded) > MAX_INPUT_BYTES * 4 // 3 + 4:
                raise ValueError("ECHO_QUALIFICATION_INPUT_TOO_LARGE")
        if job.span_job().core_duration_ms not in {2_000, 4_000, 6_000}:
            raise ValueError("ECHO_QUALIFICATION_DURATION_INVALID")
        return job

    def span_job(self) -> EchoSpanJob:
        return EchoSpanJob.from_value(
            {
                "schema_version": self.schema_version,
                "project_revision_id": self.project_revision_id,
                "span_id": self.span_id,
                "task_key": self.task_key,
                "attempt_id": self.attempt_id,
                "timeline_composition": self.timeline_composition,
                "source_url": "https://qualification.invalid/source",
                "source_sha256": self.source_sha256,
                "span_audio_url": "https://qualification.invalid/audio",
                "span_audio_sha256": self.span_audio_sha256,
                "output_put_url": "https://qualification.invalid/output",
                "prompt": self.prompt,
                "selected_start_ms": self.selected_start_ms,
                "selected_end_ms_exclusive": self.selected_end_ms_exclusive,
                "padded_start_ms": self.padded_start_ms,
                "padded_end_ms_exclusive": self.padded_end_ms_exclusive,
                "trim_start_ms": self.trim_start_ms,
                "trim_end_ms_exclusive": self.trim_end_ms_exclusive,
                "audio_sample_rate_hz": self.audio_sample_rate_hz,
                "audio_channels": self.audio_channels,
                "full_voiceover_dispatched": self.full_voiceover_dispatched,
            }
        )

    def decode_inputs(self, source_path: Path, audio_path: Path) -> None:
        for encoded, expected, destination in (
            (self.source_base64, self.source_sha256, source_path),
            (self.span_audio_base64, self.span_audio_sha256, audio_path),
        ):
            try:
                content = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError("ECHO_QUALIFICATION_BASE64_INVALID") from error
            if not content or len(content) > MAX_INPUT_BYTES:
                raise ValueError("ECHO_QUALIFICATION_INPUT_TOO_LARGE")
            observed = "sha256:" + hashlib.sha256(content).hexdigest()
            if observed != expected:
                raise ValueError("ECHO_QUALIFICATION_INPUT_HASH_MISMATCH")
            destination.write_bytes(content)
