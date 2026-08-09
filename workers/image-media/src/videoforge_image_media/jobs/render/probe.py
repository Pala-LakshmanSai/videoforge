from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from fractions import Fraction
from typing import Any, cast

from .filtergraph import LoudnessMeasurement


class ProbeValidationError(ValueError):
    pass


@dataclass(frozen=True)
class ProbeFacts:
    duration_ms: int
    total_frames: int
    video_start_ms: int
    audio_start_ms: int
    audio_channels: int
    av_drift_ms: int


def _finite_float(value: object, field: str) -> float:
    try:
        parsed = float(cast(str | int | float, value))
    except (TypeError, ValueError) as error:
        raise ProbeValidationError(f"Invalid numeric probe field {field}") from error
    if not math.isfinite(parsed):
        raise ProbeValidationError(f"Non-finite probe field {field}")
    return parsed


def parse_loudness_measurement(output: str) -> LoudnessMeasurement:
    for match in reversed(list(re.finditer(r"\{[^{}]*\}", output, re.DOTALL))):
        try:
            payload = json.loads(match.group(0))
            if not isinstance(payload, dict):
                continue
            return LoudnessMeasurement(
                integrated_lufs=_finite_float(payload["input_i"], "input_i"),
                true_peak_dbtp=_finite_float(payload["input_tp"], "input_tp"),
                loudness_range_lu=_finite_float(payload["input_lra"], "input_lra"),
                threshold_lufs=_finite_float(payload["input_thresh"], "input_thresh"),
                target_offset_db=_finite_float(payload["target_offset"], "target_offset"),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            continue
    raise ProbeValidationError("FFmpeg did not return a complete loudness measurement")


def _stream_duration(stream: dict[str, Any], field: str) -> float:
    if "duration" not in stream:
        raise ProbeValidationError(f"{field} stream duration is missing")
    return _finite_float(stream["duration"], f"{field}.duration")


def parse_ffprobe_facts(
    output: str,
    *,
    expected_total_frames: int,
    tolerance_ms: int = 34,
) -> ProbeFacts:
    try:
        payload = json.loads(output)
    except json.JSONDecodeError as error:
        raise ProbeValidationError("FFprobe returned invalid JSON") from error
    if not isinstance(payload, dict):
        raise ProbeValidationError("FFprobe result must be an object")
    streams = payload.get("streams")
    format_payload = payload.get("format")
    if not isinstance(streams, list) or not isinstance(format_payload, dict):
        raise ProbeValidationError("FFprobe streams or format are missing")

    typed_streams = [stream for stream in streams if isinstance(stream, dict)]
    video_streams = [stream for stream in typed_streams if stream.get("codec_type") == "video"]
    audio_streams = [stream for stream in typed_streams if stream.get("codec_type") == "audio"]
    subtitle_count = sum(stream.get("codec_type") == "subtitle" for stream in typed_streams)
    data_count = sum(stream.get("codec_type") == "data" for stream in typed_streams)
    if (
        len(video_streams) != 1
        or len(audio_streams) != 1
        or subtitle_count != 0
        or data_count != 0
        or len(typed_streams) != 2
    ):
        raise ProbeValidationError("Output must contain exactly one video and one audio stream")

    video = video_streams[0]
    audio = audio_streams[0]
    format_name = format_payload.get("format_name")
    if not isinstance(format_name, str) or "mp4" not in format_name.split(","):
        raise ProbeValidationError("Output container is not MP4")
    if (
        video.get("codec_name") != "h264"
        or video.get("pix_fmt") != "yuv420p"
        or video.get("width") != 1920
        or video.get("height") != 1080
    ):
        raise ProbeValidationError("Video stream does not match the fixed H.264 output profile")
    try:
        average_frame_rate = Fraction(cast(str, video.get("avg_frame_rate")))
        declared_frame_rate = Fraction(cast(str, video.get("r_frame_rate")))
    except (TypeError, ValueError, ZeroDivisionError) as error:
        raise ProbeValidationError("Video frame rate is invalid") from error
    if average_frame_rate != Fraction(30, 1) or declared_frame_rate != Fraction(30, 1):
        raise ProbeValidationError("Video frame rate must be exactly 30 fps CFR")

    frame_value = video.get("nb_read_frames", video.get("nb_frames"))
    try:
        total_frames = int(cast(str | int, frame_value))
    except (TypeError, ValueError) as error:
        raise ProbeValidationError("Decoded video frame count is missing") from error
    if total_frames != expected_total_frames:
        raise ProbeValidationError("Decoded video frame count does not match the manifest")

    try:
        sample_rate = int(cast(str | int, audio.get("sample_rate", 0)))
    except (TypeError, ValueError) as error:
        raise ProbeValidationError("Audio sample rate is invalid") from error
    if audio.get("codec_name") != "aac" or sample_rate != 48_000:
        raise ProbeValidationError("Audio stream does not match the fixed AAC 48 kHz profile")
    channels = audio.get("channels")
    if channels not in (1, 2):
        raise ProbeValidationError("Audio output must contain one or two channels")

    duration_ms = round(_finite_float(format_payload.get("duration"), "format.duration") * 1000)
    expected_duration_ms = round(expected_total_frames * 1000 / 30)
    if abs(duration_ms - expected_duration_ms) > tolerance_ms:
        raise ProbeValidationError("Muxed duration does not match the manifest frame duration")

    video_start = _finite_float(video.get("start_time", 0), "video.start_time")
    audio_start = _finite_float(audio.get("start_time", 0), "audio.start_time")
    video_start_ms = round(video_start * 1000)
    audio_start_ms = round(audio_start * 1000)
    if not (0 <= video_start_ms <= tolerance_ms and 0 <= audio_start_ms <= tolerance_ms):
        raise ProbeValidationError("Audio and video streams must start at zero within tolerance")

    video_end = video_start + _stream_duration(video, "video")
    audio_end = audio_start + _stream_duration(audio, "audio")
    av_drift_ms = round((video_end - audio_end) * 1000)
    if abs(av_drift_ms) > tolerance_ms:
        raise ProbeValidationError("Audio/video end drift exceeds one output frame")

    return ProbeFacts(
        duration_ms=duration_ms,
        total_frames=total_frames,
        video_start_ms=video_start_ms,
        audio_start_ms=audio_start_ms,
        audio_channels=cast(int, channels),
        av_drift_ms=av_drift_ms,
    )
