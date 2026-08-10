from __future__ import annotations

import copy
import hashlib
import json
import shutil
import sys
import tempfile
import unittest
import wave
from collections.abc import Callable, Sequence
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from videoforge_image_media.jobs.span_audio import (  # noqa: E402
    ProcessResult,
    SpanAudioMaterializationJob,
    SubprocessRunner,
)
from videoforge_image_media.local_cli import LocalArtifactResolver  # noqa: E402


def _sha256(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


class FakeArtifacts:
    def __init__(self, root: Path, source: Path) -> None:
        self.root = root
        self.source = source
        self.published: list[tuple[Path, str, str]] = []

    def resolve_object(self, uri: str) -> Path:
        if not uri.startswith("vf-local://objects/sha256/"):
            raise ValueError("unsafe source")
        return self.source

    def resolve_run(self, uri: str) -> Path:
        if not uri.endswith("/span-audio-result.json"):
            raise ValueError("unsafe result")
        path = self.root / "runs" / "span-audio-result.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def publish_object(self, source: Path, sha256: str, extension: str) -> str:
        self.published.append((source, sha256, extension))
        digest = sha256.removeprefix("sha256:")
        return f"vf-local://objects/sha256/{digest[:2]}/{digest}.{extension}"


class FakeProcess:
    def __init__(self, output: bytes, *, duration_ms: int = 5000, return_code: int = 0) -> None:
        self.output = output
        self.duration_ms = duration_ms
        self.return_code = return_code
        self.calls: list[tuple[str, ...]] = []

    def run(
        self,
        arguments: Sequence[str],
        *,
        should_cancel: Callable[[], bool],
    ) -> ProcessResult:
        if isinstance(arguments, str):
            raise AssertionError("span audio must use argument arrays")
        command = tuple(arguments)
        self.calls.append(command)
        if should_cancel():
            return ProcessResult(return_code=-15, cancelled=True)
        if "-show_entries" in command:
            return ProcessResult(
                return_code=0,
                stdout=json.dumps(
                    {
                        "streams": [
                            {
                                "codec_name": "pcm_s16le",
                                "sample_rate": "16000",
                                "channels": 1,
                                "duration": f"{self.duration_ms / 1000:.6f}",
                            }
                        ],
                        "format": {"duration": f"{self.duration_ms / 1000:.6f}"},
                    }
                ),
            )
        if self.return_code == 0:
            Path(command[-1]).write_bytes(self.output)
        return ProcessResult(return_code=self.return_code, stderr="redacted fixture failure")


class FakeCancellation:
    def __init__(self, cancelled: bool = False) -> None:
        self.cancelled = cancelled

    def is_cancelled(self, token: str) -> bool:
        del token
        return self.cancelled


class SpanAudioMaterializationJobTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.source_bytes = b"RIFF" + (100).to_bytes(4, "little") + b"WAVE" + (b"\x00" * 96)
        self.output_bytes = b"RIFF" + (200).to_bytes(4, "little") + b"WAVE" + (b"\x01" * 196)
        self.source_hash = _sha256(self.source_bytes)
        source_digest = self.source_hash.removeprefix("sha256:")
        self.source = self.root / "objects" / "voiceover.wav"
        self.source.parent.mkdir()
        self.source.write_bytes(self.source_bytes)
        self.ffmpeg = self.root / "tools" / "ffmpeg"
        self.ffprobe = self.root / "tools" / "ffprobe"
        self.ffmpeg.parent.mkdir()
        self.ffmpeg.write_bytes(b"fixture ffmpeg")
        self.ffprobe.write_bytes(b"fixture ffprobe")
        self.document = {
            "schema_version": "selected-span-audio-job/v1",
            "project_revision_id": "revision_local_001",
            "attempt_id": "attempt_span_local_001",
            "timeline_plan_id": "timeline_local_001",
            "transcript_id": "transcript_local_001",
            "span_id": "span_local_001",
            "timeline_segment_id": "segment_local_001",
            "task_key": "audio-span:segment_local_001",
            "source_voiceover": {
                "asset_id": "asset_voiceover_local_001",
                "sha256": self.source_hash,
                "artifact_uri": (
                    f"vf-local://objects/sha256/{source_digest[:2]}/{source_digest}.wav"
                ),
                "duration_ms": 12000,
            },
            "selection": {
                "selected_start_ms": 3000,
                "selected_end_ms_exclusive": 7000,
                "padded_start_ms": 2500,
                "padded_end_ms_exclusive": 7500,
                "trim_start_ms": 500,
                "trim_end_ms_exclusive": 4500,
            },
            "output": {
                "asset_id": "asset_span_local_001",
                "result_uri": (
                    "vf-local-run://revision_local_001/attempt_span_local_001/"
                    "span-audio-result.json"
                ),
            },
            "cancel_token": "selected-span-cancel-token-00000001",
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _run(
        self,
        *,
        document: object | None = None,
        process: FakeProcess | None = None,
        cancellation: FakeCancellation | None = None,
    ) -> tuple[dict[str, object], FakeProcess, FakeArtifacts]:
        selected_process = process or FakeProcess(self.output_bytes)
        artifacts = FakeArtifacts(self.root, self.source)
        result = SpanAudioMaterializationJob(
            artifacts=artifacts,
            process=selected_process,
            ffmpeg=self.ffmpeg,
            ffprobe=self.ffprobe,
            cancellation=cancellation or FakeCancellation(),
        ).run(copy.deepcopy(self.document) if document is None else document)
        return result, selected_process, artifacts

    def test_materializes_only_the_selected_padded_span_with_exact_lineage(self) -> None:
        result, process, artifacts = self._run()

        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(result["selection"], self.document["selection"])
        self.assertEqual(result["source_voiceover"]["sha256"], self.source_hash)
        self.assertEqual(result["audio"]["sha256"], _sha256(self.output_bytes))
        self.assertEqual(result["audio"]["duration_ms"], 5000)
        self.assertEqual(result["audio"]["sample_rate_hz"], 16000)
        self.assertEqual(result["audio"]["channels"], 1)
        self.assertEqual(len(process.calls), 2)
        ffmpeg = process.calls[0]
        self.assertEqual(ffmpeg[0], str(self.ffmpeg))
        self.assertEqual(ffmpeg[ffmpeg.index("-ss") + 1], "2.500")
        self.assertEqual(ffmpeg[ffmpeg.index("-t") + 1], "5.000")
        self.assertIn("pcm_s16le", ffmpeg)
        self.assertNotIn(self.document["cancel_token"], ffmpeg)
        self.assertEqual(len(artifacts.published), 1)
        self.assertEqual(artifacts.published[0][2], "wav")
        persisted = json.loads(
            (self.root / "runs" / "span-audio-result.json").read_text(encoding="utf-8")
        )
        self.assertEqual(persisted, result)

    def test_exact_retry_is_byte_equivalent_and_does_not_overwrite_result(self) -> None:
        first, _, _ = self._run()
        second, _, _ = self._run()
        self.assertEqual(second, first)
        self.assertEqual(
            json.loads((self.root / "runs" / "span-audio-result.json").read_text(encoding="utf-8")),
            first,
        )

    def test_invalid_boundaries_fail_before_source_or_process_access(self) -> None:
        document = copy.deepcopy(self.document)
        document["selection"]["trim_end_ms_exclusive"] = 4600
        result, process, artifacts = self._run(document=document)
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "SPAN_INPUT_INVALID")
        self.assertEqual(process.calls, [])
        self.assertEqual(artifacts.published, [])

    def test_source_hash_mismatch_never_materializes_audio(self) -> None:
        document = copy.deepcopy(self.document)
        digest = "a" * 64
        document["source_voiceover"]["sha256"] = f"sha256:{digest}"
        document["source_voiceover"]["artifact_uri"] = f"vf-local://objects/sha256/aa/{digest}.wav"
        result, process, artifacts = self._run(document=document)
        self.assertEqual(result["error"]["code"], "SPAN_SOURCE_HASH_MISMATCH")
        self.assertEqual(process.calls, [])
        self.assertEqual(artifacts.published, [])

    def test_preflight_cancellation_writes_no_audio(self) -> None:
        result, process, artifacts = self._run(cancellation=FakeCancellation(True))
        self.assertEqual(result["status"], "CANCELLED")
        self.assertEqual(result["error"]["code"], "SPAN_CANCELLED")
        self.assertEqual(process.calls, [])
        self.assertEqual(artifacts.published, [])

    def test_wrong_output_duration_is_rejected_before_publication(self) -> None:
        result, _, artifacts = self._run(process=FakeProcess(self.output_bytes, duration_ms=4999))
        self.assertEqual(result["error"]["code"], "SPAN_OUTPUT_INVALID")
        self.assertEqual(artifacts.published, [])

    def test_unknown_fields_fail_closed(self) -> None:
        document = copy.deepcopy(self.document)
        document["source_voiceover"]["full_voiceover_for_avatar"] = True
        result, process, artifacts = self._run(document=document)
        self.assertEqual(result["error"]["code"], "SPAN_INPUT_INVALID")
        self.assertEqual(process.calls, [])
        self.assertEqual(artifacts.published, [])

    def test_control_characters_in_task_key_fail_closed(self) -> None:
        document = copy.deepcopy(self.document)
        document["task_key"] = "audio-span:\nforged"
        result, process, artifacts = self._run(document=document)
        self.assertEqual(result["error"]["code"], "SPAN_INPUT_INVALID")
        self.assertEqual(process.calls, [])
        self.assertEqual(artifacts.published, [])

    def test_real_ffmpeg_materialization_is_exact_and_content_deterministic(self) -> None:
        ffmpeg_value = shutil.which("ffmpeg")
        ffprobe_value = shutil.which("ffprobe")
        self.assertIsNotNone(ffmpeg_value, "the local acceptance gate requires ffmpeg")
        self.assertIsNotNone(ffprobe_value, "the local acceptance gate requires ffprobe")
        ffmpeg = Path(ffmpeg_value).resolve(strict=True)
        ffprobe = Path(ffprobe_value).resolve(strict=True)

        source = self.root / "source.wav"
        with wave.open(str(source), "wb") as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(16000)
            stream.writeframes(b"\x00\x00" * 16000 * 12)
        source_hash = _sha256(source.read_bytes())
        digest = source_hash.removeprefix("sha256:")

        def execute(root: Path) -> dict[str, object]:
            resolver = LocalArtifactResolver(root)
            object_parent = root / "objects" / "sha256" / digest[:2]
            object_parent.mkdir(parents=True)
            object_path = object_parent / f"{digest}.wav"
            object_path.write_bytes(source.read_bytes())
            document = copy.deepcopy(self.document)
            document["source_voiceover"]["sha256"] = source_hash
            document["source_voiceover"]["artifact_uri"] = (
                f"vf-local://objects/sha256/{digest[:2]}/{digest}.wav"
            )
            return SpanAudioMaterializationJob(
                artifacts=resolver,
                process=SubprocessRunner(),
                ffmpeg=ffmpeg,
                ffprobe=ffprobe,
            ).run(document)

        first = execute(self.root / "real-run-a")
        second = execute(self.root / "real-run-b")
        self.assertEqual(first["status"], "SUCCEEDED")
        self.assertEqual(first["audio"]["duration_ms"], 5000)
        self.assertEqual(first["audio"]["sample_rate_hz"], 16000)
        self.assertEqual(first["audio"]["channels"], 1)
        self.assertEqual(second["audio"]["sha256"], first["audio"]["sha256"])
        self.assertEqual(second["audio"]["byte_size"], first["audio"]["byte_size"])

    def test_hostile_existing_result_is_never_treated_as_an_exact_retry(self) -> None:
        result_path = self.root / "runs" / "span-audio-result.json"
        result_path.parent.mkdir(parents=True)
        result_path.write_text('{"status":"SUCCEEDED","status":"FAILED"}', encoding="utf-8")
        with self.assertRaises(FileExistsError):
            self._run()


if __name__ == "__main__":
    unittest.main()
