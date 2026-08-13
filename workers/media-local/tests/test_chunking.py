from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from videoforge_media_local import (
    ChunkReconciliationError,
    build_transcript_document,
    parse_whisper_words,
    plan_chunks,
    reconcile_chunk_words,
)


class ChunkingTests(unittest.TestCase):
    def test_balances_thirty_minutes_with_exact_overlap_and_emission_coverage(self) -> None:
        windows = plan_chunks(30 * 60 * 1000)
        self.assertEqual(len(windows), 4)
        self.assertEqual(windows[0].start_ms, 0)
        self.assertEqual(windows[-1].end_ms, 1_800_000)
        for prior, current in zip(windows, windows[1:], strict=False):
            self.assertEqual(prior.end_ms - current.start_ms, 5_000)
            self.assertEqual(prior.emit_end_ms, current.emit_start_ms)
            self.assertLessEqual(prior.duration_ms, 600_000)

    def test_midpoint_ownership_deduplicates_overlap_and_keeps_monotonic_words(self) -> None:
        windows = plan_chunks(610_000)
        left, right = windows
        boundary_word_start = left.emit_end_ms - left.start_ms - 400
        words = reconcile_chunk_words(
            (
                (
                    left,
                    [
                        {"text": "before", "start_ms": 100, "end_ms": 500},
                        {
                            "text": "boundary",
                            "start_ms": boundary_word_start,
                            "end_ms": boundary_word_start + 800,
                        },
                    ],
                ),
                (
                    right,
                    [
                        {
                            "text": "boundary",
                            "start_ms": 2_100,
                            "end_ms": 2_900,
                        },
                        {"text": "after", "start_ms": 3_000, "end_ms": 3_500},
                    ],
                ),
            ),
            source_duration_ms=610_000,
        )
        self.assertEqual([word["text"] for word in words], ["before", "boundary", "after"])
        self.assertTrue(
            all(
                int(left_word["end_ms"]) <= int(right_word["start_ms"])
                for left_word, right_word in zip(words, words[1:], strict=False)
            )
        )

    def test_phrase_records_cover_every_word_exactly_once(self) -> None:
        words = [
            {"text": "Owned", "start_ms": 100, "end_ms": 500},
            {"text": "timing", "start_ms": 500, "end_ms": 900},
            {"text": "works.", "start_ms": 900, "end_ms": 1_400},
        ]
        transcript = build_transcript_document(
            words,
            project_revision_id="revision_cp03_fixture",
            source_asset_id="asset_cp03_fixture",
            source_sha256="sha256:" + "1" * 64,
            source_duration_ms=10_000,
            tool_version="1.8.4",
            model_sha256="sha256:" + "2" * 64,
        )
        phrases = transcript["phrases"]
        self.assertEqual(phrases[0]["word_start"], 0)
        self.assertEqual(phrases[-1]["word_end_exclusive"], len(words))
        for prior, current in zip(phrases, phrases[1:], strict=False):
            self.assertEqual(prior["word_end_exclusive"], current["word_start"])

    def test_rejects_empty_chunk_output(self) -> None:
        with self.assertRaises(ChunkReconciliationError):
            reconcile_chunk_words(((plan_chunks(10_000)[0], []),), source_duration_ms=10_000)

    def test_repairs_real_whisper_zero_duration_and_clamps_chunk_tail(self) -> None:
        raw = {
            "result": {"language": "en"},
            "transcription": [
                {"text": " a", "offsets": {"from": 9_000, "to": 9_000}},
                {"text": " word", "offsets": {"from": 9_000, "to": 9_500}},
                {"text": " clipped", "offsets": {"from": 9_500, "to": 15_000}},
            ],
        }
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "whisper.json"
            output.write_text(json.dumps(raw), encoding="utf-8")
            words = parse_whisper_words(
                output,
                source_duration_ms=10_000,
                allow_trailing_overhang=True,
            )
        self.assertEqual(words[0]["start_ms"], 9_000)
        self.assertEqual(words[0]["end_ms"], 9_010)
        self.assertEqual(words[1]["start_ms"], 9_010)
        self.assertEqual(words[-1]["end_ms"], 10_000)


if __name__ == "__main__":
    unittest.main()
