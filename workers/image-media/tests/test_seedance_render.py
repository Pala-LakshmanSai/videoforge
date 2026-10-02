from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_render_job import RenderFixture
from videoforge_image_media.jobs.render.filtergraph import (
    LoudnessMeasurement,
    compile_render_command,
)


def motion_fixture(frames: int = 60) -> RenderFixture:
    fixture = RenderFixture()
    video = fixture._store_object("asset_seedance_001", "VIDEO", "mp4", b"seedance clip")
    fixture.document["schema_version"] = "render-job-input/v2"
    fixture.document["assets"].append(video)
    path = fixture.resolver.objects[video["artifact_uri"]]
    fixture.process.visual_probes[path] = ("h264", 1248, 704, "24/1")
    fixture.process.visual_durations[path] = "5.0"
    fixture.process.avatar_audio_paths.add(path)

    def mutate(manifest: dict) -> None:
        manifest["schema_version"] = "resolved-render-manifest/v2"
        segment = next(s for s in manifest["segments"] if s["timeline_composition"] == "IMAGE_FULL")
        segment["accepted_assets"]["video"] = {k: video[k] for k in ("asset_id", "sha256")}
        segment["render"].update(
            video_source_profile="seedance-pro-fast-1248x704-v1",
            video_frame_count=frames,
        )

    fixture.replace_manifest(mutate)
    return fixture


class SeedanceRenderTests(unittest.TestCase):
    def test_motion_prefix_keeps_narration_and_rejects_invalid_native_media(self) -> None:
        fixture = motion_fixture()
        result = fixture.job().run(
            fixture.document, claimed_attempt_id=fixture.document["attempt_id"]
        )
        self.assertEqual(result["status"], "SUCCEEDED", result)
        command = next(call for call in fixture.process.calls if "-filter_complex" in call)
        graph = command[command.index("-filter_complex") + 1]
        self.assertIn("trim=end_frame=60", graph)
        self.assertIn("concat=n=2:v=1:a=0", graph)
        self.assertNotIn(":a:0]", graph.split("concat=n=2:v=1:a=0")[0])
        for change in ("short", "geometry", "fps", "codec"):
            with self.subTest(change=change):
                fixture = motion_fixture()
                path = next(p for p in fixture.process.visual_durations)
                if change == "short":
                    fixture.process.visual_durations[path] = "1.9"
                elif change == "geometry":
                    fixture.process.visual_probes[path] = ("h264", 1280, 720, "24/1")
                elif change == "fps":
                    fixture.process.visual_probes[path] = ("h264", 1248, 704, "0/0")
                else:
                    fixture.process.visual_probes[path] = ("vp9", 1248, 704, "24/1")
                result = fixture.job().run(
                    fixture.document, claimed_attempt_id=fixture.document["attempt_id"]
                )
                self.assertEqual(result["error"]["code"], "RENDER_INPUT_INVALID")
                self.assertFalse(fixture.resolver.published)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
    def test_real_decode_exact_motion_frames_and_still_remainder(self) -> None:
        ffmpeg = Path(shutil.which("ffmpeg"))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video, image, voiceover = root / "video.mp4", root / "image.png", root / "voiceover.wav"

            def generate(*args: str) -> None:
                subprocess.run([str(ffmpeg), "-v", "error", "-nostdin", *args], check=True)

            generate(
                "-f",
                "lavfi",
                "-i",
                "color=red:s=1248x704:r=24:d=5",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(video),
            )
            generate("-f", "lavfi", "-i", "color=blue:s=1280x720", "-frames:v", "1", str(image))
            generate(
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=7",
                str(voiceover),
            )
            manifest = {
                "render_profile_version": "ffmpeg-render-v3",
                "total_frames": 210,
                "segments": [
                    {
                        "start_frame": 0,
                        "end_frame_exclusive": 210,
                        "timeline_composition": "IMAGE_FULL",
                        "accepted_assets": {
                            "image": {"asset_id": "still"},
                            "video": {"asset_id": "motion"},
                        },
                        "render": {
                            "video_source_profile": "seedance-pro-fast-1248x704-v1",
                            "video_frame_count": 150,
                        },
                    }
                ],
            }
            for motion_frames in (150, 210):
                # The second render exercises a full-scene clip with no still input.
                manifest["segments"][0]["render"]["video_frame_count"] = motion_frames
                if motion_frames == 210:
                    generate(
                        "-f",
                        "lavfi",
                        "-i",
                        "color=red:s=1248x704:r=24:d=7",
                        "-c:v",
                        "libx264",
                        "-pix_fmt",
                        "yuv420p",
                        "-y",
                        str(video),
                    )
                output = root / f"output-{motion_frames}.mp4"
                plan = compile_render_command(
                    ffmpeg=ffmpeg,
                    manifest=manifest,
                    asset_paths={"motion": video, "still": image},
                    voiceover_path=voiceover,
                    output_path=output,
                    input_loudness=LoudnessMeasurement(-16, -4, 2, -31, 0),
                )
                subprocess.run(plan.arguments, check=True, capture_output=True)
                probe = json.loads(
                    subprocess.check_output(
                        [
                            shutil.which("ffprobe"),
                            "-v",
                            "error",
                            "-count_frames",
                            "-show_streams",
                            "-of",
                            "json",
                            str(output),
                        ]
                    )
                )
                streams = {s["codec_type"]: s for s in probe["streams"]}
                self.assertEqual(streams["video"]["nb_read_frames"], "210")
                self.assertEqual(streams["video"]["width"], 1920)
                self.assertEqual(streams["video"]["height"], 1080)
                self.assertEqual(streams["audio"]["sample_rate"], "48000")
                if motion_frames == 150:
                    boundary = subprocess.check_output(
                        [
                            str(ffmpeg),
                            "-v",
                            "error",
                            "-i",
                            str(output),
                            "-vf",
                            "select=eq(n\\,149)+eq(n\\,150),scale=1:1",
                            "-fps_mode",
                            "passthrough",
                            "-f",
                            "rawvideo",
                            "-pix_fmt",
                            "rgb24",
                            "-",
                        ]
                    )
                    self.assertEqual(len(boundary), 6)
                    self.assertGreater(boundary[0], 240)  # Last motion frame is red.
                    self.assertGreater(boundary[5], 240)  # First still frame is blue.


if __name__ == "__main__":
    unittest.main()
