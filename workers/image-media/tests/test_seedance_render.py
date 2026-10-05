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
    def test_split_motion_requires_v4_and_full_scene_video(self) -> None:
        for change in ("valid", "v3", "input_v3", "partial", "short", "budget"):
            with self.subTest(change=change):
                fixture = motion_fixture(150)
                split_video = fixture._store_object(
                    "asset_seedance_split_001", "VIDEO", "mp4", b"distinct split clip"
                )
                fixture.document["assets"].append(split_video)
                split_path = fixture.resolver.objects[split_video["artifact_uri"]]
                fixture.process.visual_probes[split_path] = ("h264", 1248, 704, "24/1")
                fixture.process.visual_durations[split_path] = "5.0"
                fixture.process.avatar_audio_paths.add(split_path)
                policy = {
                    "coverage_percent": 75,
                    "replacement_policy": "WHOLE_SCENE_V2",
                    "selection_sha256": "sha256:" + "9" * 64,
                }
                fixture.document.update(schema_version="render-job-input/v4", video_policy=policy)

                def mutate(manifest: dict) -> None:
                    manifest.update(
                        schema_version="resolved-render-manifest/v4", video_policy=policy
                    )
                    split = manifest["segments"][2]
                    split["accepted_assets"]["video"] = {
                        k: split_video[k] for k in ("asset_id", "sha256")
                    }
                    split["render"].update(
                        video_source_profile="seedance-pro-fast-1248x704-v1",
                        video_frame_count=119 if change == "partial" else 120,
                    )
                    if change == "v3":
                        manifest["schema_version"] = "resolved-render-manifest/v3"
                        fixture.document["schema_version"] = "render-job-input/v3"
                    if change == "budget":
                        policy["coverage_percent"] = 50

                fixture.replace_manifest(mutate)
                if change == "input_v3":
                    fixture.document["schema_version"] = "render-job-input/v3"
                if change == "short":
                    fixture.process.visual_durations[split_path] = "3.99"
                result = fixture.job().run(
                    fixture.document, claimed_attempt_id=fixture.document["attempt_id"]
                )
                if change == "valid":
                    self.assertEqual(result["status"], "SUCCEEDED", result)
                    command = next(c for c in fixture.process.calls if "-filter_complex" in c)
                    graph = command[command.index("-filter_complex") + 1]
                    self.assertIn("hstack=inputs=2", graph)
                    self.assertNotIn("zoompan", graph)
                    self.assertNotIn("[motion1][still1]", graph)
                else:
                    self.assertEqual(result["error"]["code"], "RENDER_INPUT_INVALID", result)
                    self.assertFalse(fixture.resolver.published)

    def test_v4_avatar_off_renders_without_avatar_assets(self) -> None:
        fixture = motion_fixture(150)
        policy = {
            "coverage_percent": 50,
            "replacement_policy": "WHOLE_SCENE_V2",
            "selection_sha256": "sha256:" + "9" * 64,
        }
        fixture.document.update(schema_version="render-job-input/v4", video_policy=policy)
        fixture.document["assets"] = [
            asset for asset in fixture.document["assets"] if asset["kind"] != "AVATAR_CLIP"
        ]

        def mutate(manifest: dict) -> None:
            manifest.update(schema_version="resolved-render-manifest/v4", video_policy=policy)
            image = manifest["segments"][1]["accepted_assets"]["image"]
            for segment in manifest["segments"]:
                if segment["timeline_composition"] == "IMAGE_FULL":
                    continue
                photo = segment["accepted_assets"].get("right_image", image)
                segment.update(
                    timeline_composition="IMAGE_FULL",
                    accepted_assets={"image": photo},
                    render={"image_scale": "1920:1080", "zoom_profile": "image-full-zoom-v3"},
                )

        fixture.replace_manifest(mutate)
        result = fixture.job().run(
            fixture.document, claimed_attempt_id=fixture.document["attempt_id"]
        )
        self.assertEqual(result["status"], "SUCCEEDED", result)
        command = next(c for c in fixture.process.calls if "-filter_complex" in c)
        self.assertNotIn("hstack", command[command.index("-filter_complex") + 1])

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

    def test_whole_scene_policy_rejects_partial_and_forged_binding(self) -> None:
        policy = {
            "coverage_percent": 50,
            "replacement_policy": "WHOLE_SCENE_V2",
            "selection_sha256": "sha256:" + "9" * 64,
        }
        for change in ("valid", "partial", "budget", "binding", "short", "off"):
            with self.subTest(change=change):
                fixture = motion_fixture(150)
                fixture.document["schema_version"] = "render-job-input/v3"
                fixture.document["video_policy"] = dict(policy)

                def mutate(manifest: dict) -> None:
                    manifest["schema_version"] = "resolved-render-manifest/v3"
                    manifest["video_policy"] = dict(policy)
                    if change == "partial":
                        manifest["segments"][1]["render"]["video_frame_count"] = 149
                    if change in {"budget", "off"}:
                        manifest["video_policy"]["coverage_percent"] = (
                            7 if change == "budget" else 0
                        )
                        fixture.document["video_policy"] = dict(manifest["video_policy"])

                fixture.replace_manifest(mutate)
                if change == "binding":
                    fixture.document["video_policy"]["selection_sha256"] = "sha256:" + "8" * 64
                if change == "short":
                    path = next(p for p in fixture.process.visual_durations)
                    fixture.process.visual_durations[path] = "4.99"
                result = fixture.job().run(
                    fixture.document, claimed_attempt_id=fixture.document["attempt_id"]
                )
                if change == "valid":
                    self.assertEqual(result["status"], "SUCCEEDED", result)
                    command = next(c for c in fixture.process.calls if "-filter_complex" in c)
                    graph = command[command.index("-filter_complex") + 1]
                    self.assertNotIn("[motion1][still1]", graph)
                    self.assertIn("trim=end_frame=150", graph)
                else:
                    self.assertEqual(result["error"]["code"], "RENDER_INPUT_INVALID", result)
                    self.assertFalse(fixture.resolver.published)

    def test_whole_scene_provider_headroom_boundary(self) -> None:
        for frames in (357, 358):
            with self.subTest(frames=frames):
                fixture = motion_fixture(frames)
                policy = {
                    "coverage_percent": 100,
                    "replacement_policy": "WHOLE_SCENE_V2",
                    "selection_sha256": "sha256:" + "9" * 64,
                }
                fixture.document.update(schema_version="render-job-input/v3", video_policy=policy)
                fixture.document["assets"] = [
                    asset for asset in fixture.document["assets"] if asset["kind"] != "AVATAR_CLIP"
                ]
                fixture.process.visual_durations[next(iter(fixture.process.visual_durations))] = (
                    "12.0"
                )

                def mutate(manifest: dict) -> None:
                    manifest.update(
                        schema_version="resolved-render-manifest/v3", video_policy=policy
                    )
                    first = manifest["segments"][1]
                    first.update(start_frame=0, end_frame_exclusive=frames)
                    split = manifest["segments"][2]
                    final = {
                        "segment_id": "next_scene",
                        "start_frame": frames,
                        "end_frame_exclusive": 360,
                        "timeline_composition": "IMAGE_FULL",
                        "accepted_assets": {"image": split["accepted_assets"]["right_image"]},
                        "render": {
                            "image_scale": "1920:1080",
                            "zoom_profile": "image-full-zoom-v3",
                        },
                    }
                    manifest["segments"] = [first, final]

                fixture.replace_manifest(mutate)
                result = fixture.job().run(
                    fixture.document, claimed_attempt_id=fixture.document["attempt_id"]
                )
                self.assertEqual(
                    result["status"], "SUCCEEDED" if frames == 357 else "FAILED", result
                )
                if frames == 358:
                    self.assertEqual(result["error"]["code"], "RENDER_INPUT_INVALID")
                    self.assertFalse(fixture.resolver.published)

    def test_off_and_whole_scene_fallback_preserve_manifest_policy(self) -> None:
        fixture = RenderFixture()
        policy = {
            "coverage_percent": 0,
            "replacement_policy": "WHOLE_SCENE_V2",
            "selection_sha256": "sha256:" + "9" * 64,
        }
        fixture.document.update(schema_version="render-job-input/v3", video_policy=policy)
        fixture.replace_manifest(
            lambda manifest: manifest.update(
                schema_version="resolved-render-manifest/v3", video_policy=policy
            )
        )
        result = fixture.job().run(
            fixture.document, claimed_attempt_id=fixture.document["attempt_id"]
        )
        self.assertEqual(result["status"], "SUCCEEDED", result)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
    def test_real_whole_scene_decodes_every_frame_and_cuts_to_next_scene(self) -> None:
        ffmpeg = Path(shutil.which("ffmpeg"))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video, image, voiceover, avatar = (
                root / "motion.mp4",
                root / "still.png",
                root / "voiceover.wav",
                root / "avatar.mp4",
            )

            def generate(*args: str) -> None:
                subprocess.run([str(ffmpeg), "-v", "error", "-nostdin", *args], check=True)

            generate(
                "-f",
                "lavfi",
                "-i",
                "color=red:s=1248x704:r=24:d=2.1,geq=r=255:g='mod(N*5,80)':b=0",
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
                "color=lime:s=960x960:r=25:d=2.1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(avatar),
            )
            generate(
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=3",
                str(voiceover),
            )
            manifest = {
                "schema_version": "resolved-render-manifest/v3",
                "render_profile_version": "ffmpeg-render-v3",
                "total_frames": 90,
                "video_policy": {
                    "coverage_percent": 75,
                    "replacement_policy": "WHOLE_SCENE_V2",
                    "selection_sha256": "sha256:" + "9" * 64,
                },
                "segments": [
                    {
                        "start_frame": 0,
                        "end_frame_exclusive": 60,
                        "timeline_composition": "IMAGE_FULL",
                        "accepted_assets": {
                            "image": {"asset_id": "still"},
                            "video": {"asset_id": "motion"},
                        },
                        "render": {
                            "video_source_profile": "seedance-pro-fast-1248x704-v1",
                            "video_frame_count": 60,
                        },
                    },
                    {
                        "start_frame": 60,
                        "end_frame_exclusive": 90,
                        "timeline_composition": "IMAGE_FULL",
                        "accepted_assets": {"image": {"asset_id": "still"}},
                        "render": {},
                    },
                ],
            }
            output = root / "output.mp4"
            plan = compile_render_command(
                ffmpeg=ffmpeg,
                manifest=manifest,
                asset_paths={"motion": video, "still": image},
                voiceover_path=voiceover,
                output_path=output,
                input_loudness=LoudnessMeasurement(-16, -4, 2, -31, 0),
            )
            subprocess.run(plan.arguments, check=True, capture_output=True)
            decoded = subprocess.check_output(
                [
                    str(ffmpeg),
                    "-v",
                    "error",
                    "-i",
                    str(output),
                    "-vf",
                    "scale=1:1",
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "rgb24",
                    "-",
                ]
            )
            self.assertEqual(len(decoded), 90 * 3)
            pixels = [tuple(decoded[n : n + 3]) for n in range(0, len(decoded), 3)]
            self.assertTrue(all(red > 230 and blue < 15 for red, _, blue in pixels[:60]))
            self.assertGreater(len({green for _, green, _ in pixels[:60]}), 10)
            self.assertTrue(all(blue > 230 and red < 15 for red, _, blue in pixels[60:]))
            probe = json.loads(
                subprocess.check_output(
                    [
                        shutil.which("ffprobe"),
                        "-v",
                        "error",
                        "-show_streams",
                        "-of",
                        "json",
                        str(output),
                    ]
                )
            )
            streams = {stream["codec_type"]: stream for stream in probe["streams"]}
            self.assertEqual(streams["video"]["nb_frames"], "90")
            self.assertEqual(streams["audio"]["sample_rate"], "48000")
            self.assertAlmostEqual(float(streams["audio"]["duration"]), 3.0, places=2)

            # v4 must preserve the left avatar and replace only the right photo.
            # Removing the avatar must produce the same moving footage at full width.
            manifest["schema_version"] = "resolved-render-manifest/v4"
            first = manifest["segments"][0]
            for avatar_enabled in (True, False):
                with self.subTest(avatar_enabled=avatar_enabled):
                    if avatar_enabled:
                        first["timeline_composition"] = "AVATAR_SPLIT_IMAGE"
                        first["accepted_assets"] = {
                            "avatar": {"asset_id": "avatar"},
                            "right_image": {"asset_id": "still"},
                            "video": {"asset_id": "motion"},
                        }
                        first["render"].update(
                            avatar_source_profile="skyreels-centered-960x960p25-v2",
                            avatar_crop="480:540:240:210",
                        )
                    else:
                        first["timeline_composition"] = "IMAGE_FULL"
                        first["accepted_assets"] = {
                            "image": {"asset_id": "still"},
                            "video": {"asset_id": "motion"},
                        }
                        first["render"].pop("avatar_source_profile")
                        first["render"].pop("avatar_crop")
                    output = root / f"v4-avatar-{avatar_enabled}.mp4"
                    plan = compile_render_command(
                        ffmpeg=ffmpeg,
                        manifest=manifest,
                        asset_paths={
                            "motion": video,
                            "still": image,
                            **({"avatar": avatar} if avatar_enabled else {}),
                        },
                        voiceover_path=voiceover,
                        output_path=output,
                        input_loudness=LoudnessMeasurement(-16, -4, 2, -31, 0),
                    )
                    subprocess.run(plan.arguments, check=True, capture_output=True)
                    for side, x in (("left", 0), ("right", 960)):
                        decoded = subprocess.check_output(
                            [
                                str(ffmpeg),
                                "-v",
                                "error",
                                "-i",
                                str(output),
                                "-vf",
                                f"crop=960:1080:{x}:0,scale=1:1",
                                "-f",
                                "rawvideo",
                                "-pix_fmt",
                                "rgb24",
                                "-",
                            ]
                        )
                        self.assertEqual(len(decoded), 90 * 3)
                        pixels = [tuple(decoded[n : n + 3]) for n in range(0, len(decoded), 3)]
                        if avatar_enabled and side == "left":
                            self.assertTrue(all(g > 230 and r < 15 for r, g, _ in pixels[:60]))
                        else:
                            self.assertTrue(all(r > 230 and b < 15 for r, _, b in pixels[:60]))
                            self.assertGreater(len({g for _, g, _ in pixels[:60]}), 10)
                        self.assertTrue(all(b > 230 and r < 15 for r, _, b in pixels[60:]))
                    probe = json.loads(
                        subprocess.check_output(
                            [
                                shutil.which("ffprobe"),
                                "-v",
                                "error",
                                "-show_streams",
                                "-of",
                                "json",
                                str(output),
                            ]
                        )
                    )
                    streams = {stream["codec_type"]: stream for stream in probe["streams"]}
                    self.assertEqual(streams["video"]["nb_frames"], "90")
                    self.assertEqual(streams["audio"]["sample_rate"], "48000")
                    self.assertAlmostEqual(float(streams["audio"]["duration"]), 3.0, places=2)

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
