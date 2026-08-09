from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from videoforge_contracts import AsrJobResultDocument  # noqa: E402
from videoforge_image_media.jobs.transcribe import (  # noqa: E402
    ProcessResult,
    TranscriptionJob,
    WhisperTool,
)


def _sha256(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _whisper_output() -> dict[str, object]:
    specifications = [
        ("Fresh", 0, 700),
        ("watermelons", 700, 2100),
        ("reveal", 2100, 3000),
        ("their", 3000, 3500),
        ("quality", 3500, 4700),
        ("through", 5400, 6200),
        ("simple", 6200, 7000),
        ("careful", 7000, 8000),
    ]
    transcription: list[dict[str, object]] = []
    for text, start, end in specifications:
        transcription.append(
            {
                "offsets": {"from": start, "to": end},
                "text": f" {text}",
            }
        )
    transcription.append(
        {
            "offsets": {"from": 8000, "to": 9000},
            "text": " checks.",
        }
    )
    return {
        "systeminfo": "redacted fixture system",
        "model": {"type": "base", "multilingual": False},
        "params": {"model": "/private/model", "language": "en", "translate": False},
        "result": {"language": "en"},
        "transcription": transcription,
    }


class FakeArtifactResolver:
    def __init__(self, root: Path, source_path: Path) -> None:
        self.root = root
        self.source_path = source_path
        self.calls: list[tuple[str, str]] = []

    def resolve_object(self, uri: str) -> Path:
        self.calls.append(("object", uri))
        if not uri.startswith("vf-local://objects/"):
            raise ValueError("unsafe object URI")
        return self.source_path

    def resolve_run(self, uri: str) -> Path:
        self.calls.append(("run", uri))
        if not uri.startswith("vf-local-run://"):
            raise ValueError("unsafe run URI")
        return self.root / "runs" / "asr-result.json"


class FakeToolResolver:
    def __init__(self, tool: WhisperTool) -> None:
        self.tool = tool
        self.calls: list[tuple[str, str]] = []

    def resolve(self, engine: str, model_name: str) -> WhisperTool:
        self.calls.append((engine, model_name))
        return self.tool


class FakeProcessRunner:
    def __init__(
        self,
        *,
        raw_document: object | None = None,
        result: ProcessResult | None = None,
        normalization_result: ProcessResult | None = None,
        probe_result: ProcessResult | None = None,
        raw_text: str | None = None,
    ) -> None:
        self.raw_document = raw_document
        self.result = result or ProcessResult(return_code=0)
        self.normalization_result = normalization_result or ProcessResult(return_code=0)
        self.probe_result = probe_result or ProcessResult(
            return_code=0,
            stdout=json.dumps(
                {"streams": [{"duration": "12.000000"}], "format": {"duration": "12.000000"}}
            ),
        )
        self.raw_text = raw_text
        self.arguments: tuple[str, ...] | None = None
        self.commands: list[tuple[str, ...]] = []
        self.calls = 0

    def run(
        self,
        arguments: Sequence[str],
        *,
        should_cancel: Callable[[], bool],
    ) -> ProcessResult:
        self.calls += 1
        self.arguments = tuple(arguments)
        self.commands.append(self.arguments)
        if should_cancel():
            return ProcessResult(return_code=-15, cancelled=True)
        if "-show_entries" in self.arguments:
            return self.probe_result
        if "-nostdin" in self.arguments:
            if (
                self.normalization_result.return_code == 0
                and not self.normalization_result.cancelled
            ):
                Path(self.arguments[-1]).write_bytes(b"normalized 16 kHz mono PCM fixture")
            return self.normalization_result
        if self.result.return_code == 0 and not self.result.cancelled:
            output_index = self.arguments.index("--output-file") + 1
            output_path = Path(f"{self.arguments[output_index]}.json")
            if self.raw_text is not None:
                output_path.write_text(self.raw_text, encoding="utf-8")
            elif self.raw_document is not None:
                output_path.write_text(json.dumps(self.raw_document), encoding="utf-8")
        return self.result


class FakeCancellation:
    def __init__(self, cancelled: bool = False) -> None:
        self.cancelled = cancelled
        self.tokens: list[str] = []

    def is_cancelled(self, token: str) -> bool:
        self.tokens.append(token)
        return self.cancelled


class FakeDiagnostics:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, str | int | bool]]] = []

    def record(self, event: str, fields: Mapping[str, str | int | bool]) -> None:
        self.events.append((event, dict(fields)))


class SequenceClock:
    def __init__(self, *values: float) -> None:
        self.values = list(values)

    def __call__(self) -> float:
        if len(self.values) > 1:
            return self.values.pop(0)
        return self.values[0]


class TranscriptionJobTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source_bytes = (
            b"RIFF"
            + (36).to_bytes(4, "little")
            + b"WAVEfmt "
            + (16).to_bytes(4, "little")
            + (b"\x00" * 24)
        )
        self.model_bytes = b"pinned whisper base.en model bytes"
        self.source_path = self.root / "objects" / "voiceover.wav"
        self.model_path = self.root / "models" / "ggml-base.en.bin"
        self.tool_path = self.root / "tools" / "whisper-cli"
        self.ffmpeg_path = self.root / "tools" / "ffmpeg"
        self.ffprobe_path = self.root / "tools" / "ffprobe"
        self.source_path.parent.mkdir(parents=True)
        self.model_path.parent.mkdir(parents=True)
        self.tool_path.parent.mkdir(parents=True)
        self.source_path.write_bytes(self.source_bytes)
        self.model_path.write_bytes(self.model_bytes)
        self.tool_path.write_bytes(b"fixture executable")
        self.ffmpeg_path.write_bytes(b"fixture ffmpeg executable")
        self.ffprobe_path.write_bytes(b"fixture ffprobe executable")
        self.source_hash = _sha256(self.source_bytes)
        self.model_hash = _sha256(self.model_bytes)
        source_hex = self.source_hash.removeprefix("sha256:")
        self.cancel_token = "cancel-token-with-secret-material-000001"
        self.document: dict[str, Any] = {
            "schema_version": "asr-job-input/v1",
            "project_revision_id": "revision_local_001",
            "attempt_id": "attempt_asr_local_001",
            "voiceover": {
                "asset_id": "asset_voiceover_local_001",
                "sha256": self.source_hash,
                "artifact_uri": (f"vf-local://objects/sha256/{source_hex[:2]}/{source_hex}.wav"),
                "media_type": "audio/wav",
                "duration_ms": 12000,
            },
            "model": {
                "engine": "whisper.cpp",
                "name": "base.en",
                "sha256": self.model_hash,
                "language": "en",
            },
            "options": {
                "threads": 4,
                "processors": 1,
                "flash_attention": True,
                "greedy": True,
                "split_on_word": True,
            },
            "output": {
                "result_uri": (
                    "vf-local-run://revision_local_001/attempt_asr_local_001/asr-result.json"
                )
            },
            "cancel_token": self.cancel_token,
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _run(
        self,
        *,
        document: dict[str, Any] | None = None,
        process: FakeProcessRunner | None = None,
        cancellation: FakeCancellation | None = None,
        diagnostics: FakeDiagnostics | None = None,
        artifacts: FakeArtifactResolver | None = None,
        tool: WhisperTool | None = None,
    ) -> tuple[dict[str, Any], FakeProcessRunner, FakeArtifactResolver, FakeDiagnostics]:
        selected_process = process or FakeProcessRunner(raw_document=_whisper_output())
        selected_artifacts = artifacts or FakeArtifactResolver(self.root, self.source_path)
        selected_diagnostics = diagnostics or FakeDiagnostics()
        selected_tool = tool or WhisperTool(
            self.tool_path,
            self.model_path,
            "1.8.4",
            self.ffmpeg_path,
            self.ffprobe_path,
        )
        job = TranscriptionJob(
            artifacts=selected_artifacts,
            tools=FakeToolResolver(selected_tool),
            processes=selected_process,
            cancellation=cancellation or FakeCancellation(),
            diagnostics=selected_diagnostics,
            monotonic=SequenceClock(10.0, 11.43),
        )
        result = job.run(document or copy.deepcopy(self.document))
        return result, selected_process, selected_artifacts, selected_diagnostics

    def assert_error(self, result: dict[str, Any], code: str, status: str = "FAILED") -> None:
        self.assertEqual(result["schema_version"], "asr-job-result/v1")
        self.assertEqual(result["status"], status)
        self.assertEqual(result["error"]["code"], code)
        self.assertIsNone(result["transcript"])
        AsrJobResultDocument.model_validate(result)

    def test_success_emits_contract_valid_canonical_timing_and_safe_argument_array(self) -> None:
        result, process, artifacts, diagnostics = self._run()

        self.assertEqual(result["status"], "SUCCEEDED")
        AsrJobResultDocument.model_validate(result)
        transcript = result["transcript"]
        self.assertEqual([word["index"] for word in transcript["words"]], list(range(9)))
        self.assertEqual(transcript["words"][-1]["text"], "checks.")
        self.assertIsNone(transcript["words"][-1]["confidence"])
        self.assertEqual(
            [
                (phrase["word_start"], phrase["word_end_exclusive"])
                for phrase in transcript["phrases"]
            ],
            [(0, 4), (4, 5), (5, 9)],
        )
        self.assertEqual(result["diagnostics"]["decode_duration_ms"], 1430)
        self.assertEqual(result["source_voiceover_sha256"], self.source_hash)
        self.assertEqual(result["model_sha256"], self.model_hash)

        self.assertIsInstance(process.arguments, tuple)
        self.assertEqual(len(process.commands), 3)
        probe_command = list(process.commands[0])
        normalization_command = list(process.commands[1])
        command = list(process.commands[2])
        self.assertEqual(probe_command[0], str(self.ffprobe_path))
        self.assertIn("stream=duration:format=duration", probe_command)
        self.assertEqual(normalization_command[0], str(self.ffmpeg_path))
        self.assertIn("-nostdin", normalization_command)
        self.assertIn("16000", normalization_command)
        self.assertIn("pcm_s16le", normalization_command)
        for required in (
            "--model",
            "--file",
            "--language",
            "--best-of",
            "--beam-size",
            "--no-fallback",
            "--max-len",
            "--split-on-word",
            "--output-json",
            "--no-prints",
            "--flash-attn",
        ):
            self.assertIn(required, command)
        self.assertNotIn(self.cancel_token, command)
        self.assertFalse(any(value.startswith("http") for value in command))
        self.assertEqual([kind for kind, _ in artifacts.calls], ["run", "object"])

        output_path = self.root / "runs" / "asr-result.json"
        self.assertEqual(json.loads(output_path.read_text(encoding="utf-8")), result)
        serialized = json.dumps(result)
        self.assertNotIn("canonical_hash", serialized)
        self.assertNotIn("jcs", serialized.casefold())
        self.assertNotIn(self.cancel_token, json.dumps(diagnostics.events))

    def test_invalid_input_is_rejected_before_artifact_or_process_access(self) -> None:
        document = copy.deepcopy(self.document)
        document["voiceover"]["artifact_uri"] = "https://example.invalid/secret.wav"
        artifacts = FakeArtifactResolver(self.root, self.source_path)
        result, process, _, _ = self._run(document=document, artifacts=artifacts)
        self.assert_error(result, "ASR_INPUT_INVALID")
        self.assertEqual(artifacts.calls, [])
        self.assertEqual(process.calls, 0)

    def test_content_address_and_run_uri_must_bind_to_input_claims(self) -> None:
        mismatched_documents = []
        object_mismatch = copy.deepcopy(self.document)
        object_mismatch["voiceover"]["artifact_uri"] = (
            f"vf-local://objects/sha256/bb/{'b' * 64}.wav"
        )
        mismatched_documents.append(object_mismatch)
        run_mismatch = copy.deepcopy(self.document)
        run_mismatch["output"]["result_uri"] = (
            "vf-local-run://revision_local_001/attempt_asr_local_999/asr-result.json"
        )
        mismatched_documents.append(run_mismatch)
        filename_mismatch = copy.deepcopy(self.document)
        filename_mismatch["output"]["result_uri"] = (
            "vf-local-run://revision_local_001/attempt_asr_local_001/other-result.json"
        )
        mismatched_documents.append(filename_mismatch)

        for document in mismatched_documents:
            with self.subTest(result_uri=document["output"]["result_uri"]):
                artifacts = FakeArtifactResolver(self.root, self.source_path)
                result, process, _, _ = self._run(document=document, artifacts=artifacts)
                self.assert_error(result, "ASR_INPUT_INVALID")
                self.assertEqual(artifacts.calls, [])
                self.assertEqual(process.calls, 0)

    def test_declared_media_type_must_match_source_magic(self) -> None:
        document = copy.deepcopy(self.document)
        document["voiceover"]["media_type"] = "audio/flac"

        result, process, _, _ = self._run(document=document)

        self.assert_error(result, "ASR_SOURCE_DECODE_FAILED")
        self.assertEqual(process.calls, 0)

    def test_missing_tool_has_precise_error(self) -> None:
        self.tool_path.unlink()
        result, process, _, _ = self._run()
        self.assert_error(result, "ASR_TOOL_MISSING")
        self.assertEqual(process.calls, 0)

    def test_missing_model_has_precise_error(self) -> None:
        self.model_path.unlink()
        result, process, _, _ = self._run()
        self.assert_error(result, "ASR_MODEL_MISSING")
        self.assertEqual(process.calls, 0)

    def test_missing_ffmpeg_has_tool_error(self) -> None:
        self.ffmpeg_path.unlink()
        result, process, _, _ = self._run()
        self.assert_error(result, "ASR_TOOL_MISSING")
        self.assertEqual(process.calls, 0)

    def test_missing_ffprobe_has_tool_error(self) -> None:
        self.ffprobe_path.unlink()
        result, process, _, _ = self._run()
        self.assert_error(result, "ASR_TOOL_MISSING")
        self.assertEqual(process.calls, 0)

    def test_source_hash_mismatch_stops_before_process(self) -> None:
        document = copy.deepcopy(self.document)
        wrong_hash = "sha256:" + ("a" * 64)
        document["voiceover"]["sha256"] = wrong_hash
        document["voiceover"]["artifact_uri"] = f"vf-local://objects/sha256/aa/{'a' * 64}.wav"
        result, process, _, _ = self._run(document=document)
        self.assert_error(result, "ASR_SOURCE_HASH_MISMATCH")
        self.assertEqual(process.calls, 0)

    def test_model_hash_mismatch_stops_before_process(self) -> None:
        document = copy.deepcopy(self.document)
        document["model"]["sha256"] = "sha256:" + ("b" * 64)
        result, process, _, _ = self._run(document=document)
        self.assert_error(result, "ASR_MODEL_HASH_MISMATCH")
        self.assertEqual(process.calls, 0)

    def test_generic_process_failure_is_retryable_and_redacted(self) -> None:
        secret = "Bearer process-secret-credential"
        process = FakeProcessRunner(result=ProcessResult(return_code=9, stderr=secret))
        diagnostics = FakeDiagnostics()
        result, _, _, _ = self._run(process=process, diagnostics=diagnostics)
        self.assert_error(result, "ASR_PROCESS_FAILED")
        self.assertTrue(result["error"]["retryable"])
        self.assertNotIn(secret, json.dumps(result))
        self.assertNotIn(secret, json.dumps(diagnostics.events))

    def test_decode_process_failure_has_source_decode_error(self) -> None:
        process = FakeProcessRunner(
            normalization_result=ProcessResult(
                return_code=2,
                stderr="failed to read audio file /private/sensitive/source.wav",
            )
        )
        result, _, _, diagnostics = self._run(process=process)
        self.assert_error(result, "ASR_SOURCE_DECODE_FAILED")
        self.assertNotIn("/private/sensitive", json.dumps(result))
        self.assertNotIn("/private/sensitive", json.dumps(diagnostics.events))

    def test_probed_duration_within_tolerance_is_authoritative(self) -> None:
        process = FakeProcessRunner(
            raw_document=_whisper_output(),
            probe_result=ProcessResult(
                return_code=0,
                stdout=json.dumps(
                    {
                        "streams": [{"duration": "12.2494"}],
                        "format": {"duration": "12.2494"},
                    }
                ),
            ),
        )
        result, _, _, _ = self._run(process=process)
        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(result["transcript"]["source"]["duration_ms"], 12249)
        self.assertEqual(result["diagnostics"]["source_duration_ms"], 12249)

    def test_probed_duration_outside_tolerance_rejects_claim(self) -> None:
        process = FakeProcessRunner(
            probe_result=ProcessResult(
                return_code=0,
                stdout=json.dumps(
                    {"streams": [{"duration": "12.251"}], "format": {"duration": "12.251"}}
                ),
            )
        )
        result, _, _, _ = self._run(process=process)
        self.assert_error(result, "ASR_INPUT_INVALID")
        self.assertEqual(process.calls, 1)

    def test_invalid_probe_output_has_source_decode_error(self) -> None:
        process = FakeProcessRunner(probe_result=ProcessResult(return_code=0, stdout="{}"))
        result, _, _, _ = self._run(process=process)
        self.assert_error(result, "ASR_SOURCE_DECODE_FAILED")
        self.assertEqual(process.calls, 1)

    def test_invalid_or_missing_json_output_has_output_error(self) -> None:
        for process in (
            FakeProcessRunner(raw_text="not-json"),
            FakeProcessRunner(raw_document=None),
        ):
            with self.subTest(process=process):
                result, _, _, _ = self._run(process=process)
                self.assert_error(result, "ASR_OUTPUT_INVALID")

    def test_overlapping_word_timestamps_are_rejected(self) -> None:
        raw_document = _whisper_output()
        second = raw_document["transcription"][1]
        second["offsets"]["from"] = 600
        result, _, _, _ = self._run(process=FakeProcessRunner(raw_document=raw_document))
        self.assert_error(result, "ASR_OUTPUT_INVALID")

    def test_timestamp_beyond_duration_tolerance_is_rejected(self) -> None:
        raw_document = _whisper_output()
        last = raw_document["transcription"][-1]
        last["offsets"]["to"] = 13000
        result, _, _, _ = self._run(process=FakeProcessRunner(raw_document=raw_document))
        self.assert_error(result, "ASR_OUTPUT_INVALID")

    def test_phrase_boundaries_are_deterministic_bounded_and_cover_every_word(self) -> None:
        texts = [
            "Fresh",
            "fruit",
            "looks",
            "bright,",
            "and",
            "careful",
            "checks",
            "confirm",
            "quality",
            "before",
            "buyers",
            "choose",
            "it.",
        ]
        transcription = [
            {
                "text": f" {text}",
                "offsets": {"from": index * 650, "to": index * 650 + 500},
            }
            for index, text in enumerate(texts)
        ]
        raw_document = {
            "result": {"language": "en"},
            "transcription": transcription,
        }

        first, _, _, _ = self._run(process=FakeProcessRunner(raw_document=raw_document))
        second, _, _, _ = self._run(process=FakeProcessRunner(raw_document=raw_document))
        self.assertEqual(first, second)
        self.assertEqual(first["status"], "SUCCEEDED")
        transcript = first["transcript"]
        self.assertEqual(transcript["text"], " ".join(texts))
        covered = [
            index
            for phrase in transcript["phrases"]
            for index in range(phrase["word_start"], phrase["word_end_exclusive"])
        ]
        self.assertEqual(covered, list(range(len(texts))))
        self.assertEqual(
            [phrase["phrase_id"] for phrase in transcript["phrases"]],
            [f"phrase_{index:04d}" for index in range(1, len(transcript["phrases"]) + 1)],
        )
        self.assertTrue(
            all(phrase["end_ms"] - phrase["start_ms"] <= 4500 for phrase in transcript["phrases"])
        )

    def test_preflight_cancellation_never_invokes_process(self) -> None:
        result, process, _, _ = self._run(cancellation=FakeCancellation(cancelled=True))
        self.assert_error(result, "ASR_CANCELLED", status="CANCELLED")
        self.assertEqual(process.calls, 0)

    def test_in_process_cancellation_has_cancelled_result(self) -> None:
        process = FakeProcessRunner(result=ProcessResult(return_code=-15, cancelled=True))
        result, _, _, _ = self._run(process=process)
        self.assert_error(result, "ASR_CANCELLED", status="CANCELLED")

    def test_process_launch_race_maps_missing_binary_without_leaking_paths(self) -> None:
        process = FakeProcessRunner(
            result=ProcessResult(return_code=-1, launch_error="missing", stderr=str(self.tool_path))
        )
        result, _, _, diagnostics = self._run(process=process)
        self.assert_error(result, "ASR_TOOL_MISSING")
        self.assertNotIn(str(self.tool_path), json.dumps(result))
        self.assertNotIn(str(self.tool_path), json.dumps(diagnostics.events))


if __name__ == "__main__":
    unittest.main()
