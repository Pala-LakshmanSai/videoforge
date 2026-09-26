"""Compare Fal composition against frozen 0.1.42 source using synthetic media.

Usage: python benchmark.py --baseline PATH --ffmpeg PATH --scratch PATH
Output files stay in scratch; only numeric timings and parity facts are evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from videoforge_image_media.jobs.render import fal_wide as candidate


def elapsed(call):
    started = time.perf_counter()
    value = call()
    return time.perf_counter() - started, value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--clip-only", action="store_true",
                        help="One cheap encoded clip pair after a source-only change")
    args = parser.parse_args()
    args.scratch.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("fal_speed_baseline", args.baseline)
    baseline = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = baseline
    spec.loader.exec_module(baseline)

    rng = np.random.default_rng(74)
    background = cv2.GaussianBlur(
        rng.integers(0, 256, (1080, 1920, 3), dtype=np.uint8), (5, 5), 0
    )
    for _ in range(250):
        x, y = rng.integers((0, 0), (1920, 1080))
        cv2.circle(background, (int(x), int(y)), int(rng.integers(4, 25)),
                   tuple(int(v) for v in rng.integers(0, 256, 3)), -1)
    source = args.scratch / "synthetic-source.png"
    cv2.imwrite(str(source), background)
    reference = background[200:712, 600:1112].copy()
    frames = [cv2.warpAffine(reference, np.float32([[1, 0, dx], [0, 1, dy]]),
                            (512, 512), borderMode=cv2.BORDER_REFLECT)
              for dx, dy in [(0, 0), (4, -2), (-4, 3), (2, 1)]]
    square = args.scratch / "synthetic-square.mp4"
    writer = cv2.VideoWriter(str(square), cv2.VideoWriter_fourcc(*"mp4v"), 25, (512, 512))
    for index in range(75):
        writer.write(frames[index % len(frames)])
    writer.release()
    prepared = candidate.prepare_fal_source(source)

    # Match the previous source work, excluding the clip-specific sample detector.
    def previous_prep():
        image = cv2.resize(cv2.imread(str(source)), (1920, 1080), interpolation=cv2.INTER_AREA)
        detector = cv2.ORB_create(nfeatures=5000)
        features = detector.detectAndCompute(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), None)
        return image, features, baseline._blend_mask()

    prep_times = {"baseline_seconds": [], "candidate_seconds": []}
    for _ in range(1 if args.clip_only else 6):
        duration, old = elapsed(previous_prep)
        prep_times["baseline_seconds"].append(duration)
        duration, fresh = elapsed(lambda: candidate.prepare_fal_source(source))
        prep_times["candidate_seconds"].append(duration)
        np.testing.assert_array_equal(old[0], fresh.background)
        np.testing.assert_array_equal(old[1][1], fresh.source_features[1])
        np.testing.assert_array_equal(old[2], fresh.blend_mask)

    def frame_pass(optimized, scale=1):
        digest = hashlib.sha256()
        clip_registration = np.array([[scale, 0, 400], [0, scale, 0], [0, 0, 1]], dtype=float)
        clip_bounds = (400, 0, 400 + 512 * scale, 512 * scale)
        clip_reference = cv2.warpPerspective(
            background, np.linalg.inv(clip_registration), (512, 512)
        )
        clip_frames = [cv2.warpAffine(clip_reference, np.float32([[1, 0, dx], [0, 1, dy]]),
                                     (512, 512), borderMode=cv2.BORDER_REFLECT)
                       for dx, dy in [(0, 0), (4, -2), (-4, 3), (2, 1)]]
        if optimized:
            compositor = candidate._WideFrameComposer(background, clip_registration, clip_bounds,
                                                       candidate._blend_mask())
            apply = compositor.apply
        else:
            anchor = baseline._LowerCropAnchor(clip_reference)
            transform = np.diag([scale, scale, 1]).astype(float)
            maps = baseline._perspective_maps(transform, (512 * scale, 512 * scale))
            alpha = cv2.warpPerspective(baseline._blend_mask(), transform,
                                       (512 * scale, 512 * scale))[:, :, None]
            backdrop = background[:512 * scale, 400:400 + 512 * scale].astype(np.float32)
            backdrop *= 1 - alpha
            wide = background.copy()

            def apply(frame):
                warped = cv2.remap(anchor.apply(frame), *maps, cv2.INTER_CUBIC)
                wide[:512 * scale, 400:400 + 512 * scale] = (
                    warped.astype(np.float32) * alpha + backdrop
                ).astype(np.uint8)
                return wide
        for index in range(100):
            result = apply(clip_frames[index % len(clip_frames)])
            digest.update(memoryview(result))
        return digest.hexdigest()

    frame_times = {"baseline_seconds": [], "candidate_seconds": []}
    frame_hashes = []
    for repeat in range(0 if args.clip_only else 4):
        variants = (False, True) if repeat % 2 == 0 else (True, False)
        for optimized in variants:
            duration, digest = elapsed(lambda optimized=optimized: frame_pass(optimized))
            frame_times["candidate_seconds" if optimized else "baseline_seconds"].append(duration)
            frame_hashes.append(digest)
    assert len(set(frame_hashes)) <= 1

    large_frame_times = {"baseline_seconds": [], "candidate_seconds": []}
    large_frame_hashes = []
    for repeat in range(0 if args.clip_only else 4):
        variants = (False, True) if repeat % 2 == 0 else (True, False)
        for optimized in variants:
            duration, digest = elapsed(lambda optimized=optimized: frame_pass(optimized, 2))
            large_frame_times[
                "candidate_seconds" if optimized else "baseline_seconds"
            ].append(duration)
            large_frame_hashes.append(digest)
    assert len(set(large_frame_hashes)) <= 1

    compose_times = {"baseline_seconds": [], "candidate_seconds": []}
    file_hashes = []
    decoded_hashes = []
    for repeat in range(1 if args.clip_only else 3):
        variants = (False, True) if repeat % 2 == 0 else (True, False)
        for optimized in variants:
            output = args.scratch / f"compose-{repeat}-{optimized}.mp4"
            output.unlink(missing_ok=True)
            if optimized:
                def operation(output=output):
                    candidate.compose_fal_wide(
                        square, source, output, args.ffmpeg, prepared_source=prepared
                    )
            else:
                def operation(output=output):
                    baseline.compose_fal_wide(square, source, output, args.ffmpeg)
            duration, _ = elapsed(operation)
            compose_times["candidate_seconds" if optimized else "baseline_seconds"].append(duration)
            file_hashes.append(hashlib.sha256(output.read_bytes()).hexdigest())
            # Capture a frame digest without materializing full decoded video in memory.
            digest_output = subprocess.run(
                [str(args.ffmpeg), "-v", "error", "-i", str(output), "-map", "0:v",
                 "-f", "hash", "-hash", "sha256", "-"], check=True, capture_output=True,
                creationflags=candidate.background_creationflags(),
            )
            decoded_hashes.append(digest_output.stdout.decode().strip())
    assert len(set(decoded_hashes)) == 1

    for collection in (prep_times, frame_times, large_frame_times, compose_times):
        if not collection["baseline_seconds"]:
            continue
        collection["baseline_median_seconds"] = statistics.median(collection["baseline_seconds"])
        collection["candidate_median_seconds"] = statistics.median(collection["candidate_seconds"])
        collection["median_reduction_percent"] = 100 * (
            1 - collection["candidate_median_seconds"] / collection["baseline_median_seconds"]
        )
    result = {
        "scope": "clip-only" if args.clip_only else "full-synthetic-matrix",
        "baseline_source_sha256": hashlib.sha256(args.baseline.read_bytes()).hexdigest(),
        "candidate_source_sha256": hashlib.sha256(
            Path(candidate.__file__).read_bytes()
        ).hexdigest(),
        "python": sys.version, "opencv": cv2.__version__, "numpy": np.__version__,
        "opencv_threads": cv2.getNumThreads(),
        "ffmpeg_sha256": hashlib.sha256(args.ffmpeg.read_bytes()).hexdigest(),
        "source_preparation": prep_times,
        "frame_composition_100_frames": frame_times,
        "frame_composition_100_frames_1024px_region": large_frame_times,
        "complete_clip_75_frames_cached_source": compose_times,
        "frame_pixels_exact": len(set(frame_hashes)) == 1 if frame_hashes else None,
        "large_frame_pixels_exact": (
            len(set(large_frame_hashes)) == 1 if large_frame_hashes else None
        ),
        "encoded_files_identical": len(set(file_hashes)) == 1,
        "decoded_videos_identical": len(set(decoded_hashes)) == 1,
        "all_outputs_video_sha256": decoded_hashes[0],
        "source_cache_expected_repeated_90_clips_prep_seconds": {
            "baseline": prep_times["baseline_median_seconds"] * 90,
            "candidate": prep_times["candidate_median_seconds"],
        },
        "limitations": [
            "Synthetic source and 512px moving crop, not retained production avatars.",
            "Frame-only and short complete-clip measurements are not full assembly timings.",
            "No concurrent work, no altered OpenCV/FFmpeg thread or quality settings.",
            "Electricity use is unmeasured; no additional generation or provider compute.",
        ],
    }
    result_name = "fal-speed-clip-only-results.json" if args.clip_only else "fal-speed-results.json"
    (args.scratch / result_name).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
