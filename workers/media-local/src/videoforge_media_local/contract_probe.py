from __future__ import annotations

import hashlib
import json

from . import build_transcript_document, plan_chunks, reconcile_chunk_words


def canonical_hash(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def probe() -> dict[str, object]:
    plans = {
        str(duration): [
            {
                "index": window.index,
                "start_ms": window.start_ms,
                "end_ms": window.end_ms,
                "emit_start_ms": window.emit_start_ms,
                "emit_end_ms": window.emit_end_ms,
            }
            for window in plan_chunks(duration)
        ]
        for duration in (10_000, 610_000, 1_800_000)
    }
    window = plan_chunks(10_000)[0]
    words = reconcile_chunk_words(
        (
            (
                window,
                [
                    {"text": "Owned", "start_ms": 100, "end_ms": 500},
                    {"text": "timing", "start_ms": 500, "end_ms": 900},
                    {"text": "works.", "start_ms": 900, "end_ms": 1_400},
                ],
            ),
        ),
        source_duration_ms=10_000,
    )
    transcript = build_transcript_document(
        words,
        project_revision_id="revision_cp03_contract_probe",
        source_asset_id="asset_cp03_contract_probe",
        source_sha256="sha256:" + "1" * 64,
        source_duration_ms=10_000,
        tool_version="1.8.4",
        model_sha256="sha256:" + "2" * 64,
    )
    return {
        "schema_version": "videoforge.cp03-container-contract-probe/v1",
        "chunk_plans": plans,
        "transcript_sha256": canonical_hash(transcript),
        "word_count": len(words),
        "phrase_count": len(transcript["phrases"]),
    }


if __name__ == "__main__":
    print(json.dumps(probe(), ensure_ascii=False, sort_keys=True, separators=(",", ":")))
