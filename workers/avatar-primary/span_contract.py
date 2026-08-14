from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Final

ID: Final = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
SHA256: Final = re.compile(r"^sha256:[a-f0-9]{64}$")
ALLOWED_COMPOSITIONS: Final = {"AVATAR_FULL", "AVATAR_SPLIT_IMAGE"}
CORE_MINIMUM_MS: Final = 2_000
CORE_MAXIMUM_MS: Final = 6_000
CONTEXT_PADDING_MS: Final = 500
SAMPLE_RATE_HZ: Final = 16_000
CHANNELS: Final = 1
NATIVE_FPS: Final = 25


def inference_frame_count(padded_duration_ms: int) -> int:
    raw = max(1, (padded_duration_ms * NATIVE_FPS + 999) // 1_000)
    return ((raw - 1 + 3) // 4) * 4 + 1


@dataclass(frozen=True, slots=True)
class EchoSpanJob:
    schema_version: str
    project_revision_id: str
    span_id: str
    task_key: str
    attempt_id: str
    timeline_composition: str
    source_url: str
    source_sha256: str
    span_audio_url: str
    span_audio_sha256: str
    output_put_url: str
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
    def from_value(cls, value: object) -> EchoSpanJob:
        expected = set(cls.__dataclass_fields__)
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError("ECHO_SPAN_JOB_SHAPE_INVALID")
        job = cls(**value)
        if job.schema_version != "videoforge.echo-span-job/v1":
            raise ValueError("ECHO_SPAN_JOB_SCHEMA_INVALID")
        for identifier in (
            job.project_revision_id,
            job.span_id,
            job.task_key,
            job.attempt_id,
        ):
            if not isinstance(identifier, str) or ID.fullmatch(identifier) is None:
                raise ValueError("ECHO_SPAN_JOB_ID_INVALID")
        if job.timeline_composition not in ALLOWED_COMPOSITIONS:
            raise ValueError("ECHO_SPAN_COMPOSITION_INVALID")
        for url in (job.source_url, job.span_audio_url, job.output_put_url):
            if not isinstance(url, str) or not url.startswith("https://") or len(url) > 8_192:
                raise ValueError("ECHO_SPAN_URL_INVALID")
        for digest in (job.source_sha256, job.span_audio_sha256):
            if not isinstance(digest, str) or SHA256.fullmatch(digest) is None:
                raise ValueError("ECHO_SPAN_HASH_INVALID")
        if not isinstance(job.prompt, str) or not 1 <= len(job.prompt.strip()) <= 1_200:
            raise ValueError("ECHO_SPAN_PROMPT_INVALID")
        if job.full_voiceover_dispatched is not False:
            raise ValueError("ECHO_FULL_VOICEOVER_FORBIDDEN")
        if job.audio_sample_rate_hz != SAMPLE_RATE_HZ or job.audio_channels != CHANNELS:
            raise ValueError("ECHO_SPAN_AUDIO_PROFILE_INVALID")
        if not all(
            isinstance(value, int)
            for value in (
                job.selected_start_ms,
                job.selected_end_ms_exclusive,
                job.padded_start_ms,
                job.padded_end_ms_exclusive,
                job.trim_start_ms,
                job.trim_end_ms_exclusive,
            )
        ):
            raise ValueError("ECHO_SPAN_TIMING_INVALID")
        core_duration = job.selected_end_ms_exclusive - job.selected_start_ms
        if not CORE_MINIMUM_MS <= core_duration <= CORE_MAXIMUM_MS:
            raise ValueError("ECHO_SPAN_DURATION_INVALID")
        if (
            job.padded_start_ms < 0
            or job.padded_start_ms > job.selected_start_ms
            or job.selected_end_ms_exclusive > job.padded_end_ms_exclusive
            or job.selected_start_ms - job.padded_start_ms > CONTEXT_PADDING_MS
            or job.padded_end_ms_exclusive - job.selected_end_ms_exclusive > CONTEXT_PADDING_MS
            or job.trim_start_ms != job.selected_start_ms - job.padded_start_ms
            or job.trim_end_ms_exclusive != job.trim_start_ms + core_duration
            or job.trim_end_ms_exclusive > job.padded_end_ms_exclusive - job.padded_start_ms
        ):
            raise ValueError("ECHO_SPAN_TIMING_INVALID")
        return job

    @property
    def core_duration_ms(self) -> int:
        return self.selected_end_ms_exclusive - self.selected_start_ms

    @property
    def padded_duration_ms(self) -> int:
        return self.padded_end_ms_exclusive - self.padded_start_ms

    @property
    def inference_frames(self) -> int:
        return inference_frame_count(self.padded_duration_ms)


def require_exact_media_probe(
    *,
    audio_sample_rate_hz: int,
    audio_channels: int,
    audio_duration_ms: int,
    job: EchoSpanJob,
) -> None:
    if audio_sample_rate_hz != SAMPLE_RATE_HZ or audio_channels != CHANNELS:
        raise ValueError("ECHO_SPAN_AUDIO_PROFILE_INVALID")
    if abs(audio_duration_ms - job.padded_duration_ms) > 1:
        raise ValueError("ECHO_SPAN_AUDIO_DURATION_MISMATCH")


def validate_output_probe(
    *,
    duration_ms: int,
    fps: int,
    width: int,
    height: int,
    has_video: bool,
    has_audio: bool,
    job: EchoSpanJob,
) -> None:
    tolerance_ms = (1_000 + NATIVE_FPS - 1) // NATIVE_FPS
    if (
        not has_video
        or not has_audio
        or fps != NATIVE_FPS
        or width < 16
        or height < 16
        or abs(duration_ms - job.core_duration_ms) > tolerance_ms
    ):
        raise ValueError("ECHO_SPAN_OUTPUT_INVALID")


def trim_filter(job: EchoSpanJob) -> str:
    start = f"{job.trim_start_ms / 1_000:.3f}"
    end = f"{job.trim_end_ms_exclusive / 1_000:.3f}"
    return f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v];[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a]"


def reject_model_mount_output(output_path: Path, model_root: Path) -> None:
    try:
        output_path.resolve().relative_to(model_root.resolve())
    except ValueError:
        return
    raise ValueError("ECHO_MODEL_VOLUME_WRITE_FORBIDDEN")
