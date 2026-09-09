from __future__ import annotations

import copy

from videoforge_image_media.local_cli import main as shared_media_main
from videoforge_image_media.jobs.span_audio import job as span_audio_job

from .artifacts import R2PortFixtureArtifactResolver

_shared_span_document = span_audio_job._validate_document


def _personal_worker_span_document(document: object) -> dict[str, object]:
    """Accept the full 0..39 ms terminal slack produced by 25 fps outward snapping."""

    try:
        return _shared_span_document(document)
    except (TypeError, ValueError) as original_error:
        if not isinstance(document, dict) or document.get("output_profile") != "SOULX_PCM16_48K_MONO":
            raise original_error
        source = document.get("source_voiceover")
        selection = document.get("selection")
        if not isinstance(source, dict) or not isinstance(selection, dict):
            raise original_error
        duration = source.get("duration_ms")
        padded_end = selection.get("padded_end_ms_exclusive")
        if (
            isinstance(duration, bool)
            or not isinstance(duration, int)
            or isinstance(padded_end, bool)
            or not isinstance(padded_end, int)
            or padded_end <= duration + 20
            or padded_end > duration + 39
        ):
            raise original_error
        adjusted = copy.deepcopy(document)
        adjusted["source_voiceover"]["duration_ms"] = padded_end - 20
        parsed = _shared_span_document(adjusted)
        parsed["source_voiceover"]["duration_ms"] = duration
        return parsed


def main() -> int:
    original = span_audio_job._validate_document
    span_audio_job._validate_document = _personal_worker_span_document
    try:
        return shared_media_main(
            resolver_factory=R2PortFixtureArtifactResolver,
            accepted_commands=frozenset({"transcribe", "materialize-span", "render"}),
        )
    finally:
        span_audio_job._validate_document = original


if __name__ == "__main__":
    raise SystemExit(main())
