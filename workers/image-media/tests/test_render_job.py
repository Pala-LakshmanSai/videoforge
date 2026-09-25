from __future__ import annotations

import copy
import hashlib
import json
import unittest
from unittest.mock import Mock, patch
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from videoforge_image_media.jobs.render import (
    NeverCancelled,
    ProcessResult,
    RenderJob,
    RenderJobDependencies,
    RenderTools,
)


def digest(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def object_uri(sha256: str, extension: str) -> str:
    value = sha256.removeprefix("sha256:")
    return f"vf-local://objects/sha256/{value[:2]}/{value}.{extension}"


class FakeArtifacts:
    def __init__(self) -> None:
        self.files: dict[Path, bytes] = {}

    def exists(self, path: Path) -> bool:
        return path in self.files

    def read_bytes(self, path: Path) -> bytes:
        return self.files[path]

    def size(self, path: Path) -> int:
        return len(self.files[path])

    def sha256(self, path: Path) -> str:
        return digest(self.files[path])


class FakeResolver:
    def __init__(self) -> None:
        self.objects: dict[str, Path] = {}
        self.runs: dict[str, Path] = {}
        self.published: list[tuple[Path, str, str]] = []
        self.reject_objects = False

    def resolve_object(self, uri: str) -> Path:
        if self.reject_objects:
            raise ValueError("rejected")
        return self.objects[uri]

    def resolve_run(self, uri: str) -> Path:
        return self.runs[uri]

    def publish_object(self, source: Path, sha256: str, extension: str) -> str:
        self.published.append((source, sha256, extension))
        return object_uri(sha256, extension)


class FakeTools:
    def resolve(self) -> RenderTools:
        return RenderTools(
            ffmpeg=Path("/trusted/bin/ffmpeg"),
            ffprobe=Path("/trusted/bin/ffprobe"),
            ffmpeg_version="8.1.1",
            ffprobe_version="8.1.1",
        )


class MutableCancellation:
    def __init__(self, cancelled: bool = False) -> None:
        self.cancelled = cancelled

    def is_cancelled(self, token: str) -> bool:
        del token
        return self.cancelled


class FakeProcess:
    def __init__(self, artifacts: FakeArtifacts, output_bytes: bytes) -> None:
        self.artifacts = artifacts
        self.output_bytes = output_bytes
        self.calls: list[tuple[str, ...]] = []
        self.render_return_code = 0
        self.render_stderr = "redacted failure"
        self.correction_return_code = 0
        self.emit_render_output = True
        self.probe_frame_count = 360
        self.include_subtitle = False
        self.invalid_sample_rate = False
        self.input_loudness = (-21.4, -4.7)
        self.output_loudness = (-16.0, -2.1)
        self.corrected_loudness = (-16.43, -5.27)
        self.visual_probes: dict[Path, tuple[str, int, int, str]] = {}
        self.nominal_frame_rates: dict[Path, str] = {}
        self.visual_durations: dict[Path, str] = {}
        self.avatar_audio_paths: set[Path] = set()

    @staticmethod
    def _loudness_payload(values: tuple[float, float]) -> str:
        integrated, peak = values
        return json.dumps(
            {
                "input_i": str(integrated),
                "input_tp": str(peak),
                "input_lra": "2.0",
                "input_thresh": "-31.0",
                "target_offset": "0.1",
            }
        )

    def _probe_payload(self, path: Path) -> str:
        visual = self.visual_probes.get(path)
        if visual is not None:
            codec, width, height, frame_rate = visual
            nominal_frame_rate = self.nominal_frame_rates.get(path, frame_rate)
            streams: list[dict[str, Any]] = [
                {
                    "codec_type": "video",
                    "codec_name": codec,
                    "width": width,
                    "height": height,
                    "avg_frame_rate": frame_rate,
                    "r_frame_rate": nominal_frame_rate,
                    **(
                        {"duration": self.visual_durations[path]}
                        if path in self.visual_durations
                        else {}
                    ),
                }
            ]
            if path in self.avatar_audio_paths:
                streams.append({"codec_type": "audio", "codec_name": "aac"})
            return json.dumps({"streams": streams})
        streams: list[dict[str, Any]] = [
            {
                "codec_type": "video",
                "codec_name": "h264",
                "pix_fmt": "yuv420p",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "30/1",
                "r_frame_rate": "30/1",
                "nb_read_frames": str(self.probe_frame_count),
                "start_time": "0.000000",
                "duration": "12.000000",
            },
            {
                "codec_type": "audio",
                "codec_name": "aac",
                "sample_rate": "not-a-rate" if self.invalid_sample_rate else "48000",
                "channels": 1,
                "start_time": "0.000000",
                "duration": "12.000000",
            },
        ]
        if self.include_subtitle:
            streams.append({"codec_type": "subtitle", "codec_name": "mov_text"})
        return json.dumps(
            {
                "streams": streams,
                "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "12.0"},
            }
        )

    def run(
        self,
        arguments: Sequence[str],
        *,
        should_cancel: Callable[[], bool],
    ) -> ProcessResult:
        if isinstance(arguments, str):
            raise AssertionError("render tools must receive argument arrays")
        call = tuple(arguments)
        self.calls.append(call)
        if should_cancel():
            return ProcessResult(return_code=-1, cancelled=True)
        executable = Path(call[0]).name
        if executable == "ffprobe":
            return ProcessResult(return_code=0, stdout=self._probe_payload(Path(call[-1])))
        if "-c:v" in call and call[call.index("-c:v") + 1] == "copy":
            if self.correction_return_code:
                return ProcessResult(
                    return_code=self.correction_return_code, stderr=self.render_stderr
                )
            self.artifacts.files[Path(call[-1])] = b"audio corrected mp4 bytes"
            return ProcessResult(return_code=0)
        if "-af" in call:
            source = Path(call[call.index("-i") + 1])
            values = (
                self.corrected_loudness
                if source.name.endswith("-audio-corrected.mp4")
                else self.output_loudness
                if source.name == "videoforge-local-short-slice.mp4"
                else self.input_loudness
            )
            return ProcessResult(return_code=0, stderr=self._loudness_payload(values))
        if "-filter_complex" in call:
            if self.render_return_code != 0:
                return ProcessResult(return_code=self.render_return_code, stderr=self.render_stderr)
            if self.emit_render_output:
                self.artifacts.files[Path(call[-1])] = self.output_bytes
            return ProcessResult(return_code=0)
        if "-xerror" in call:
            return ProcessResult(return_code=0)
        raise AssertionError(f"Unexpected process call: {call}")


class RenderFixture:
    def __init__(self) -> None:
        self.artifacts = FakeArtifacts()
        self.resolver = FakeResolver()
        self.output_bytes = b"owned deterministic synthetic mp4 bytes"
        self.process = FakeProcess(self.artifacts, self.output_bytes)
        self.cancellation: MutableCancellation | NeverCancelled = NeverCancelled()
        self.document = self._build_document()

    def _store_object(
        self, asset_id: str, kind: str, extension: str, data: bytes
    ) -> dict[str, str]:
        sha256 = digest(data)
        uri = object_uri(sha256, extension)
        path = Path(f"/safe/objects/{sha256.removeprefix('sha256:')}.{extension}")
        self.resolver.objects[uri] = path
        self.artifacts.files[path] = data
        if kind == "IMAGE":
            self.process.visual_probes[path] = ("png", 1280, 720, "25/1")
        elif kind == "AVATAR_CLIP":
            self.process.visual_probes[path] = (
                ("h264", 832, 480, "25/1") if "full" in asset_id else ("h264", 960, 960, "25/1")
            )
        return {
            "asset_id": asset_id,
            "sha256": sha256,
            "artifact_uri": uri,
            "kind": kind,
        }

    def _build_document(self) -> dict[str, Any]:
        voiceover = self._store_object(
            "asset_voiceover_local_001", "VOICEOVER", "wav", b"owned voiceover bytes"
        )
        avatar_full = self._store_object(
            "asset_avatar_full_001", "AVATAR_CLIP", "mp4", b"avatar full bytes"
        )
        image_full = self._store_object("asset_image_full_001", "IMAGE", "png", b"image full bytes")
        avatar_split = self._store_object(
            "asset_avatar_split_001", "AVATAR_CLIP", "mp4", b"avatar split bytes"
        )
        image_split = self._store_object(
            "asset_image_split_001", "IMAGE", "png", b"image split bytes"
        )
        manifest = {
            "schema_version": "resolved-render-manifest/v1",
            "project_revision_id": "revision_local_001",
            "revision_config_hash": f"sha256:{'1' * 64}",
            "timeline_plan_hash": f"sha256:{'2' * 64}",
            "render_profile_version": "ffmpeg-render-v3",
            "voiceover": {
                "asset_id": voiceover["asset_id"],
                "sha256": voiceover["sha256"],
            },
            "output": {
                "width": 1920,
                "height": 1080,
                "fps_num": 30,
                "fps_den": 1,
                "video_codec": "h264",
                "pixel_format": "yuv420p",
                "audio_codec": "aac",
                "audio_sample_rate_hz": 48000,
                "loudness_profile": "voiceover-minus16lufs-v1",
            },
            "total_frames": 360,
            "segments": [
                {
                    "segment_id": "segment_001",
                    "start_frame": 0,
                    "end_frame_exclusive": 90,
                    "timeline_composition": "AVATAR_FULL",
                    "accepted_assets": {
                        "avatar": {
                            "asset_id": avatar_full["asset_id"],
                            "sha256": avatar_full["sha256"],
                        }
                    },
                    "render": {
                        "avatar_source_profile": "avatarforcing-centered-832x480p25-v1",
                        "avatar_crop": "832:468:0:6",
                        "avatar_scale": "1920:1080",
                        "avatar_fps": "30:round=near",
                    },
                },
                {
                    "segment_id": "segment_002",
                    "start_frame": 90,
                    "end_frame_exclusive": 240,
                    "timeline_composition": "IMAGE_FULL",
                    "accepted_assets": {
                        "image": {
                            "asset_id": image_full["asset_id"],
                            "sha256": image_full["sha256"],
                        }
                    },
                    "render": {
                        "image_scale": "1920:1080",
                        "zoom_profile": "image-full-zoom-v3",
                    },
                },
                {
                    "segment_id": "segment_003",
                    "start_frame": 240,
                    "end_frame_exclusive": 360,
                    "timeline_composition": "AVATAR_SPLIT_IMAGE",
                    "accepted_assets": {
                        "avatar": {
                            "asset_id": avatar_split["asset_id"],
                            "sha256": avatar_split["sha256"],
                        },
                        "right_image": {
                            "asset_id": image_split["asset_id"],
                            "sha256": image_split["sha256"],
                        },
                    },
                    "render": {
                        "avatar_source_profile": "skyreels-centered-960x960p25-v2",
                        "avatar_crop": "480:540:240:210",
                        "avatar_scale": "960:1080",
                        "avatar_fps": "30:round=near",
                        "right_image_scale": "960:1080",
                        "right_image_zoom_profile": "split-right-zoom-v3",
                    },
                },
            ],
        }
        manifest_bytes = json.dumps(
            manifest, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
        manifest_pointer = self._store_object(
            "asset_render_manifest_local_001", "MANIFEST", "json", manifest_bytes
        )
        result_uri = (
            "vf-local-run://revision_local_001/attempt_render_local_001/"
            "videoforge-local-short-slice.mp4"
        )
        self.resolver.runs[result_uri] = Path(
            "/safe/runs/revision_local_001/attempt_render_local_001/"
            "videoforge-local-short-slice.mp4"
        )
        return {
            "schema_version": "render-job-input/v1",
            "project_revision_id": "revision_local_001",
            "attempt_id": "attempt_render_local_001",
            "resolved_render_manifest": {
                key: manifest_pointer[key] for key in ("asset_id", "sha256", "artifact_uri")
            },
            "assets": [voiceover, avatar_full, image_full, avatar_split, image_split],
            "output": {
                "result_uri": result_uri,
                "filename": "videoforge-local-short-slice.mp4",
            },
            "tools": {"ffmpeg_version": "8.1.1", "ffprobe_version": "8.1.1"},
            "cancel_token": "local-render-cancel-token-0000000000001",
        }

    def job(self, diagnostics: Any = None) -> RenderJob:
        return RenderJob(
            RenderJobDependencies(
                resolver=self.resolver,
                artifacts=self.artifacts,
                tools=FakeTools(),
                process=self.process,
                cancellation=self.cancellation,
                diagnostics=diagnostics,
            )
        )

    def replace_manifest(self, mutate: Callable[[dict[str, Any]], None]) -> None:
        pointer = self.document["resolved_render_manifest"]
        old_uri = pointer["artifact_uri"]
        old_path = self.resolver.objects.pop(old_uri)
        manifest = json.loads(self.artifacts.files.pop(old_path))
        mutate(manifest)
        data = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        sha256 = digest(data)
        uri = object_uri(sha256, "json")
        path = Path(f"/safe/objects/{sha256.removeprefix('sha256:')}.json")
        self.artifacts.files[path] = data
        self.resolver.objects[uri] = path
        pointer["sha256"] = sha256
        pointer["artifact_uri"] = uri


class RenderJobTests(unittest.TestCase):
    def test_success_compiles_only_legal_direct_ffmpeg_output(self) -> None:
        fixture = RenderFixture()
        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertIsNone(result["error"])
        self.assertEqual(result["output"]["sha256"], result["probe"]["sha256"])
        self.assertEqual(result["output"]["bytes"], result["probe"]["bytes"])
        self.assertEqual(result["output"]["asset_id"], result["probe"]["asset_id"])
        self.assertEqual(result["probe"]["duration_ms"], 12_000)
        self.assertEqual(result["probe"]["total_frames"], 360)
        self.assertEqual(
            result["probe"]["stream_counts"], {"video": 1, "audio": 1, "subtitle": 0, "data": 0}
        )
        self.assertTrue(result["probe"]["decode_ok"])
        self.assertTrue(result["probe"]["loudness"]["normalized"])
        self.assertEqual(len(fixture.resolver.published), 1)

        render_call = next(call for call in fixture.process.calls if "-filter_complex" in call)
        graph = render_call[render_call.index("-filter_complex") + 1]
        loudness_call = next(
            call
            for call in fixture.process.calls
            if "-af" in call and "-filter_complex" not in call
        )
        self.assertIn("loudnorm=I=-16:TP=-2.5", loudness_call[loudness_call.index("-af") + 1])
        self.assertIn("crop=832:468:0:6", graph)
        self.assertIn("crop=480:540:240:210", graph)
        self.assertEqual(graph.count("perspective="), 2)
        self.assertNotIn("zoompan=", graph)
        self.assertIn(
            "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080",
            graph,
        )
        self.assertIn(
            "scale=960:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=960:1080",
            graph,
        )
        self.assertIn("1+0.061256*", graph)
        self.assertIn("1+0.036300*", graph)
        self.assertNotRegex(graph, r"1\+0\.(?:04|06|08)0000\*")
        self.assertIn("interpolation=cubic:sense=source:eval=frame", graph)
        self.assertEqual(graph.count("loop=loop=-1:size=1:start=0,fps=30,perspective="), 2)
        self.assertNotIn("*(6*", graph)
        self.assertIn("1+0.061256*(on/149)", graph)
        self.assertIn("1+0.036300*(on/119)", graph)
        self.assertIn("hstack=inputs=2", graph)
        self.assertIn("concat=n=3:v=1:a=0", graph)
        self.assertIn("loudnorm=I=-16:TP=-2.5", graph)
        self.assertNotRegex(graph, r"xfade|fade=|drawtext|subtitles|overlay")
        self.assertIn("-n", render_call)
        self.assertNotIn("-y", render_call)
        self.assertIn("libx264", render_call)
        self.assertIn("yuv420p", render_call)
        self.assertIn("aac", render_call)
        self.assertIn("48000", render_call)
        self.assertIn("-map_metadata", render_call)
        self.assertIn("-sn", render_call)
        self.assertIn("-dn", render_call)

    def test_v3_zoom_moves_immediately_with_requested_full_and_split_amplitudes(self) -> None:
        from videoforge_image_media.jobs.render.filtergraph import (
            _continuous_image_filter,
            _zoom_delta,
        )

        for frames, full_delta in [(120, 0.051046875), (150, 0.06125625), (240, 0.071465625)]:
            self.assertEqual(_zoom_delta(frame_count=frames, split=False, profile_version="ffmpeg-render-v3"), full_delta)
            self.assertEqual(_zoom_delta(frame_count=frames, split=True, profile_version="ffmpeg-render-v3"), 0.0363)
            for width, delta in [(1920, full_delta), (960, 0.0363)]:
                graph = _continuous_image_filter(0, width, frames, delta)
                self.assertIn(f"1+{delta:.6f}*(on/{frames - 1})", graph)
                self.assertIn("fps=30,perspective=", graph)
                self.assertGreater(1 + delta / (frames - 1), 1)
                self.assertNotIn("eval=frame,fps=", graph)

    def test_render_argv_bounds_filter_and_codec_threads(self) -> None:
        fixture = RenderFixture()
        fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        render_call = next(call for call in fixture.process.calls if "-filter_complex" in call)
        self.assertEqual(
            render_call[1:5],
            ("-filter_complex_threads", "1", "-filter_threads", "1"),
        )
        input_positions = [index for index, argument in enumerate(render_call) if argument == "-i"]
        self.assertEqual(render_call.count("-threads"), len(input_positions) + 1)
        for index in input_positions:
            self.assertEqual(render_call[index - 2 : index], ("-threads", "1"))
        self.assertEqual(render_call[-3:-1], ("-threads", "2"))

    def test_accepts_avatar_audio_but_maps_narration_only(self) -> None:
        fixture = RenderFixture()
        avatar = next(
            asset
            for asset in fixture.document["assets"]
            if asset["asset_id"] == "asset_avatar_full_001"
        )
        avatar_path = fixture.resolver.objects[avatar["artifact_uri"]]
        fixture.process.avatar_audio_paths.add(avatar_path)

        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "SUCCEEDED")
        render_call = next(call for call in fixture.process.calls if "-filter_complex" in call)
        map_values = [
            render_call[index + 1] for index, value in enumerate(render_call) if value == "-map"
        ]
        self.assertEqual(map_values, ["[vout]", "[aout]"])

    def test_preserves_the_legacy_zoom_profile_without_mixing_versions(self) -> None:
        fixture = RenderFixture()

        def use_legacy_profile(manifest: dict[str, Any]) -> None:
            manifest["render_profile_version"] = "ffmpeg-render-v1"
            manifest["segments"][1]["render"]["zoom_profile"] = "image-full-zoom-v1"
            manifest["segments"][2]["render"]["right_image_zoom_profile"] = "split-right-zoom-v1"

        fixture.replace_manifest(use_legacy_profile)
        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "SUCCEEDED")
        render_call = next(call for call in fixture.process.calls if "-filter_complex" in call)
        graph = render_call[render_call.index("-filter_complex") + 1]
        self.assertIn(
            "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
            graph,
        )
        self.assertIn("1+0.060000*", graph)
        self.assertIn("1+0.040000*", graph)
        self.assertIn("3*(on/149)*(on/149)-2*(on/149)*(on/149)*(on/149)", graph)
        self.assertNotIn("scale=7680:4320", graph)

    def test_preserves_the_v2_precision_zoom_profile_without_mixing_versions(self) -> None:
        fixture = RenderFixture()

        def use_v2_profile(manifest: dict[str, Any]) -> None:
            manifest["render_profile_version"] = "ffmpeg-render-v2"
            manifest["segments"][1]["render"]["zoom_profile"] = "image-full-zoom-v2"
            manifest["segments"][2]["render"]["right_image_zoom_profile"] = "split-right-zoom-v2"

        fixture.replace_manifest(use_v2_profile)
        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "SUCCEEDED")
        render_call = next(call for call in fixture.process.calls if "-filter_complex" in call)
        graph = render_call[render_call.index("-filter_complex") + 1]
        self.assertEqual(graph.count("zoompan="), 2)
        self.assertNotIn("perspective=", graph)
        self.assertIn("scale=7680:4320", graph)
        self.assertIn("scale=3840:4320", graph)
        self.assertIn("1+0.020000*", graph)
        self.assertIn("1+0.015000*", graph)

    def test_split_only_soulx_render_needs_no_unreferenced_source_background(self) -> None:
        fixture = RenderFixture()
        keep = {
            "asset_voiceover_local_001",
            "asset_avatar_split_001",
            "asset_image_split_001",
        }
        fixture.document["assets"] = [
            asset for asset in fixture.document["assets"] if asset["asset_id"] in keep
        ]
        avatar = next(
            asset
            for asset in fixture.document["assets"]
            if asset["asset_id"] == "asset_avatar_split_001"
        )
        fixture.process.visual_probes[fixture.resolver.objects[avatar["artifact_uri"]]] = (
            "h264",
            512,
            512,
            "25/1",
        )

        def split_only(manifest: dict[str, Any]) -> None:
            split = manifest["segments"][2]
            split["start_frame"] = 0
            split["end_frame_exclusive"] = 360
            split["render"] = {
                "avatar_source_profile": "soulx-pro-vf924u-approved-v1",
                "crop_profile_id": "soulx-pro-ranga-split-composite-v1",
                "crop_profile_evidence_sha256": "sha256:f6c8dd219c07a26ab67fb13d8dbc103e110b4c045307f8c3e0c70aa3d805d442",
                "crop_profile_acceptance_sha256": "sha256:c3aae03da3f0134e12c2f432951189bd205dcbb7ab26a65d44061cec82984c45",
                "context_transform": "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=960:1080,zoompan=z=min(zoom+0.000133333,1.04):d=300:s=960x1080:fps=30",
                "avatar_crop": "448:504:32:4",
                "avatar_scale": "960:1080",
                "avatar_fps": "30:round=near",
                "right_image_scale": "960:1080",
                "right_image_zoom_profile": "split-right-zoom-v3",
            }
            manifest["segments"] = [split]
            manifest["total_frames"] = 360
            manifest["soulx_crop_profile_approval"] = {
                "profile_group_id": "soulx-pro-vf924u-full-split-v1",
                "candidate_sha256": "sha256:f6c8dd219c07a26ab67fb13d8dbc103e110b4c045307f8c3e0c70aa3d805d442",
                "approval_sha256": "sha256:c3aae03da3f0134e12c2f432951189bd205dcbb7ab26a65d44061cec82984c45",
                "avatar_source_sha256": "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83",
                "native_sample_sha256": "sha256:db70cd410062572052313278f12d67393aba213ca607fa3a3b9e3f6aad948bf1",
                "full_sample_sha256": "sha256:da31d87c2389769272733ff50a9114d4507a36aced1ebe48480c9ccf486de241",
                "split_sample_sha256": "sha256:f0b02351e38e2e8570e4e586b314da30813bb0a0eb09a567912bba9725b74993",
            }

        fixture.replace_manifest(split_only)
        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "SUCCEEDED")
        render_call = next(call for call in fixture.process.calls if "-filter_complex" in call)
        graph = render_call[render_call.index("-filter_complex") + 1]
        self.assertIn("zoompan=z='min(zoom+0.000133333\\,1.04)':d=300", graph)
        self.assertNotIn("source_background", graph)

    def test_rejects_render_and_zoom_profile_version_mixing(self) -> None:
        fixture = RenderFixture()
        fixture.replace_manifest(
            lambda manifest: manifest["segments"][1]["render"].update(
                {"zoom_profile": "image-full-zoom-v1"}
            )
        )

        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "RENDER_INPUT_INVALID")
        self.assertFalse(fixture.process.calls)

    def test_preserves_already_compliant_original_narration_without_loudnorm(self) -> None:
        fixture = RenderFixture()
        fixture.process.input_loudness = (-16.0, -2.0)
        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertFalse(result["probe"]["loudness"]["normalized"])
        render_call = next(call for call in fixture.process.calls if "-filter_complex" in call)
        graph = render_call[render_call.index("-filter_complex") + 1]
        self.assertNotIn("loudnorm=", graph)
        self.assertIn("aresample=48000", graph)

    def test_normalizes_and_records_a_positive_input_true_peak(self) -> None:
        fixture = RenderFixture()
        fixture.process.input_loudness = (-12.0, 0.8)
        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(result["probe"]["loudness"]["input_true_peak_dbtp"], 0.8)
        self.assertTrue(result["probe"]["loudness"]["normalized"])

    def test_corrects_failed_encoded_loudness_once_without_rerendering_video(self) -> None:
        fixture = RenderFixture()
        fixture.process.output_loudness = (-17.14, -1.55)
        result = fixture.job().run(fixture.document, claimed_attempt_id="attempt_render_local_001")
        self.assertEqual(result["status"], "SUCCEEDED")
        self.assertEqual(sum("-filter_complex" in call for call in fixture.process.calls), 1)
        correction = next(call for call in fixture.process.calls if "copy" in call)
        audio_filter = correction[correction.index("-af") + 1]
        self.assertIn("measured_I=-17.140", audio_filter)
        self.assertIn("apad,atrim=end=12.000000", audio_filter)
        self.assertNotEqual(correction[correction.index("-i") + 1], correction[-1])
        self.assertEqual(result["output"]["sha256"], digest(b"audio corrected mp4 bytes"))
        self.assertEqual(result["probe"]["loudness"]["output_integrated_lufs"], -16.43)

    def test_audio_correction_still_fails_closed_after_one_pass(self) -> None:
        fixture = RenderFixture()
        fixture.process.output_loudness = (-17.14, -1.55)
        fixture.process.corrected_loudness = (-18.0, -2.0)
        result = fixture.job().run(fixture.document, claimed_attempt_id="attempt_render_local_001")
        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "RENDER_OUTPUT_INVALID")
        self.assertEqual(sum("copy" in call for call in fixture.process.calls), 1)
        self.assertFalse(fixture.resolver.published)

    def test_audio_failure_diagnostics_exclude_stderr_paths_and_tokens(self) -> None:
        fixture = RenderFixture()
        fixture.process.output_loudness = (-17.14, -1.55)
        fixture.process.correction_return_code = 1
        fixture.process.render_stderr = (
            "No space left on device /private/secret token=private-token"
        )
        diagnostics = Mock()
        result = fixture.job(diagnostics).run(
            fixture.document, claimed_attempt_id="attempt_render_local_001"
        )
        self.assertIn("audio_correction failed: DISK_FULL (exit 1)", result["error"]["message"])
        diagnostics.record.assert_called_once_with(
            "render_process_failed",
            {"phase": "audio_correction", "return_code": 1, "reason": "DISK_FULL"},
        )
        self.assertNotIn("private", str(diagnostics.record.call_args) + json.dumps(result))

    def test_rejects_exact_byte_hash_drift_before_invoking_render(self) -> None:
        fixture = RenderFixture()
        first_asset = fixture.document["assets"][0]
        path = fixture.resolver.objects[first_asset["artifact_uri"]]
        fixture.artifacts.files[path] = b"tampered bytes"

        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "RENDER_ASSET_HASH_MISMATCH")
        self.assertFalse(any("-filter_complex" in call for call in fixture.process.calls))

        manifest_fixture = RenderFixture()
        pointer = manifest_fixture.document["resolved_render_manifest"]
        manifest_path = manifest_fixture.resolver.objects[pointer["artifact_uri"]]
        manifest_fixture.artifacts.files[manifest_path] += b" "
        manifest_result = manifest_fixture.job().run(
            manifest_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(manifest_result["error"]["code"], "RENDER_MANIFEST_HASH_MISMATCH")
        self.assertFalse(manifest_fixture.process.calls)

    def test_rejects_duplicate_assets_and_unsafe_resolver_paths(self) -> None:
        duplicate_fixture = RenderFixture()
        duplicate_fixture.document["assets"].append(
            copy.deepcopy(duplicate_fixture.document["assets"][0])
        )
        duplicate = duplicate_fixture.job().run(
            duplicate_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(duplicate["error"]["code"], "RENDER_INPUT_INVALID")

        unsafe_fixture = RenderFixture()
        unsafe_fixture.resolver.reject_objects = True
        unsafe = unsafe_fixture.job().run(
            unsafe_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(unsafe["error"]["code"], "RENDER_PATH_REJECTED")

    def test_schema_rejects_renderer_profile_crop_mismatch(self) -> None:
        fixture = RenderFixture()
        fixture.replace_manifest(
            lambda manifest: manifest["segments"][2]["render"].update(
                {"avatar_crop": "416:468:208:6"}
            )
        )

        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "RENDER_INPUT_INVALID")
        self.assertFalse(fixture.process.calls)

        cross_kind_fixture = RenderFixture()
        cross_kind_fixture.replace_manifest(
            lambda manifest: manifest["segments"][2]["accepted_assets"]["right_image"].update(
                {
                    "asset_id": "asset_distinct_alias_001",
                    "sha256": manifest["segments"][2]["accepted_assets"]["avatar"]["sha256"],
                }
            )
        )
        cross_kind = cross_kind_fixture.job().run(
            cross_kind_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(cross_kind["error"]["code"], "RENDER_ASSET_HASH_MISMATCH")
        self.assertFalse(cross_kind_fixture.process.calls)

        profile_drift_fixture = RenderFixture()

        def reuse_avatar_with_another_profile(manifest: dict[str, Any]) -> None:
            first = manifest["segments"][0]["accepted_assets"]["avatar"]
            manifest["segments"][2]["accepted_assets"]["avatar"] = copy.deepcopy(first)

        profile_drift_fixture.replace_manifest(reuse_avatar_with_another_profile)
        profile_drift = profile_drift_fixture.job().run(
            profile_drift_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(profile_drift["error"]["code"], "RENDER_INPUT_INVALID")
        self.assertFalse(profile_drift_fixture.process.calls)

        short_fixture = RenderFixture()
        short_fixture.replace_manifest(
            lambda manifest: (
                manifest.update({"total_frames": 299}),
                manifest["segments"][2].update({"end_frame_exclusive": 299}),
            )
        )
        short_result = short_fixture.job().run(
            short_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(short_result["error"]["code"], "RENDER_INPUT_INVALID")
        self.assertFalse(short_fixture.process.calls)

    def test_rejects_avatar_bytes_that_do_not_match_the_claimed_source_profile(self) -> None:
        fixture = RenderFixture()
        avatar = next(
            asset
            for asset in fixture.document["assets"]
            if asset["asset_id"] == "asset_avatar_full_001"
        )
        avatar_path = fixture.resolver.objects[avatar["artifact_uri"]]
        fixture.process.visual_probes[avatar_path] = ("h264", 1280, 720, "24/1")

        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "RENDER_INPUT_INVALID")
        self.assertFalse(any("-filter_complex" in call for call in fixture.process.calls))

    def test_fal_flashhead_profile_uses_nominal_frame_rate(self) -> None:
        fixture = RenderFixture()
        avatar = next(
            asset
            for asset in fixture.document["assets"]
            if asset["asset_id"] == "asset_avatar_full_001"
        )
        avatar_path = fixture.resolver.objects[avatar["artifact_uri"]]
        fixture.process.visual_probes[avatar_path] = ("h264", 512, 512, "1975/78")
        fixture.process.nominal_frame_rates[avatar_path] = "25/1"
        fixture.replace_manifest(
            lambda manifest: manifest["segments"][0]["render"].update(
                {
                    "avatar_source_profile": "fal-flashhead-512x512p25-v1",
                    "avatar_crop": "512:288:0:112",
                }
            )
        )

        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "SUCCEEDED", result)
        self.assertTrue(any("-filter_complex" in call for call in fixture.process.calls))

    def test_fal_trim_requires_remaining_clip_coverage(self) -> None:
        for duration, expected in [(None, "FAILED"), ("3", "FAILED"), ("30", "SUCCEEDED")]:
            with self.subTest(duration=duration):
                fixture = RenderFixture()
                avatar = next(
                    asset
                    for asset in fixture.document["assets"]
                    if asset["asset_id"] == "asset_avatar_full_001"
                )
                avatar_path = fixture.resolver.objects[avatar["artifact_uri"]]
                fixture.process.visual_probes[avatar_path] = ("h264", 512, 512, "25/1")
                if duration is not None:
                    fixture.process.visual_durations[avatar_path] = duration
                fixture.replace_manifest(
                    lambda manifest: manifest["segments"][0]["render"].update(
                        {
                            "avatar_source_profile": "fal-flashhead-512x512p25-v1",
                            "avatar_crop": "512:288:0:112",
                            "avatar_trim_start_ms": 500,
                        }
                    )
                )
                result = fixture.job().run(
                    fixture.document, claimed_attempt_id="attempt_render_local_001"
                )
                self.assertEqual(result["status"], expected, result)
                if expected == "FAILED":
                    self.assertEqual(result["error"]["code"], "RENDER_INPUT_INVALID")
                    self.assertFalse(fixture.resolver.published)

    def test_fal_flashhead_rejects_non_25_nominal_frame_rate(self) -> None:
        fixture = RenderFixture()
        avatar = next(
            asset
            for asset in fixture.document["assets"]
            if asset["asset_id"] == "asset_avatar_full_001"
        )
        avatar_path = fixture.resolver.objects[avatar["artifact_uri"]]
        fixture.process.visual_probes[avatar_path] = ("h264", 512, 512, "25/1")
        fixture.process.nominal_frame_rates[avatar_path] = "24/1"
        fixture.replace_manifest(
            lambda manifest: manifest["segments"][0]["render"].update(
                {
                    "avatar_source_profile": "fal-flashhead-512x512p25-v1",
                    "avatar_crop": "512:288:0:112",
                }
            )
        )

        result = fixture.job().run(
            fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )

        self.assertEqual(result["status"], "FAILED")
        self.assertEqual(result["error"]["code"], "RENDER_INPUT_INVALID")
        self.assertFalse(any("-filter_complex" in call for call in fixture.process.calls))

    def test_fal_wide_failure_identifies_segment_without_exposing_exception_text(self) -> None:
        for reason, expected in (
            ("Fal crop has too few source matches", "Fal crop has too few source matches"),
            ("Fal wide composition failed: /private/token=secret", "Fal wide composition failed"),
        ):
            with self.subTest(reason=reason):
                fixture = RenderFixture()
                avatar = next(
                    asset for asset in fixture.document["assets"]
                    if asset["asset_id"] == "asset_avatar_split_001"
                )
                avatar_path = fixture.resolver.objects[avatar["artifact_uri"]]
                fixture.process.visual_probes[avatar_path] = ("h264", 512, 512, "25/1")

                def use_fal_wide(manifest: dict[str, Any]) -> None:
                    segment = manifest["segments"][2]
                    segment["accepted_assets"]["source_background"] = copy.deepcopy(
                        manifest["segments"][1]["accepted_assets"]["image"]
                    )
                    segment["render"].update({
                        "avatar_source_profile": "fal-flashhead-512x512p25-wide-v2",
                        "avatar_crop": "960:1080:480:0",
                    })

                fixture.replace_manifest(use_fal_wide)
                with patch(
                    "videoforge_image_media.jobs.render.job.compose_fal_wide",
                    side_effect=ValueError(reason),
                ):
                    result = fixture.job().run(
                        fixture.document, claimed_attempt_id="attempt_render_local_001"
                    )
                self.assertEqual(result["error"]["code"], "RENDER_INPUT_INVALID")
                self.assertEqual(
                    result["error"]["message"],
                    f"Fal wide segment 3: ValueError: {expected}.",
                )
                self.assertNotIn("/private", json.dumps(result))
                self.assertFalse(result["error"]["retryable"])

    def test_process_probe_and_cancellation_fail_without_publication(self) -> None:
        process_fixture = RenderFixture()
        process_fixture.process.render_return_code = 1
        process_result = process_fixture.job().run(
            process_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(process_result["error"]["code"], "RENDER_PROCESS_FAILED")
        self.assertIn("visual_render", process_result["error"]["message"])
        self.assertFalse(process_fixture.resolver.published)

        missing_output_fixture = RenderFixture()
        missing_output_fixture.process.emit_render_output = False
        missing_output = missing_output_fixture.job().run(
            missing_output_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(missing_output["error"]["code"], "RENDER_OUTPUT_INVALID")
        self.assertFalse(missing_output_fixture.resolver.published)

        probe_fixture = RenderFixture()
        probe_fixture.process.include_subtitle = True
        probe_result = probe_fixture.job().run(
            probe_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(probe_result["error"]["code"], "RENDER_OUTPUT_INVALID")
        self.assertFalse(probe_fixture.resolver.published)

        malformed_probe_fixture = RenderFixture()
        malformed_probe_fixture.process.invalid_sample_rate = True
        malformed_probe = malformed_probe_fixture.job().run(
            malformed_probe_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(malformed_probe["error"]["code"], "RENDER_OUTPUT_INVALID")
        self.assertFalse(malformed_probe_fixture.resolver.published)

        cancelled_fixture = RenderFixture()
        cancelled_fixture.cancellation = MutableCancellation(cancelled=True)
        cancelled = cancelled_fixture.job().run(
            cancelled_fixture.document,
            claimed_attempt_id="attempt_render_local_001",
        )
        self.assertEqual(cancelled["status"], "CANCELLED")
        self.assertEqual(cancelled["error"]["code"], "RENDER_CANCELLED")
        self.assertFalse(cancelled["error"]["retryable"])
        self.assertFalse(cancelled_fixture.process.calls)
        self.assertFalse(cancelled_fixture.resolver.published)


if __name__ == "__main__":
    unittest.main()
