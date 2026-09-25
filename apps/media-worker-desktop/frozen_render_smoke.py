"""Exercise the frozen NumPy/OpenCV render path with a provider-free fixture."""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

from videoforge_image_media.jobs.render.fal_wide import compose_fal_wide


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", required=True, type=Path)
    arguments = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="videoforge-fal-smoke-") as temporary:
        root = Path(temporary)
        source = root / "source.png"
        square = root / "square.mp4"
        output = root / "wide.mp4"

        random = np.random.default_rng(20260925)
        background = random.integers(0, 256, (1080, 1920, 3), dtype=np.uint8)
        for x in range(0, 1920, 80):
            cv2.line(background, (x, 0), (x, 1079), (255, 255, 255), 2)
        for y in range(0, 1080, 80):
            cv2.line(background, (0, y), (1919, y), (0, 0, 0), 2)
        for index in range(20):
            center = (100 + index * 91, 120 + (index * 137) % 850)
            cv2.circle(
                background,
                center,
                24 + (index % 5) * 7,
                (10 + index * 11, 200 - index * 7, 40 + index * 5),
                3,
            )
        if not cv2.imwrite(str(source), background):
            raise RuntimeError("source fixture could not be written")

        subprocess.run(
            [
                str(arguments.ffmpeg),
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-loop",
                "1",
                "-i",
                str(source),
                "-vf",
                "crop=640:640:640:180,scale=512:512:flags=lanczos",
                "-r",
                "25",
                "-t",
                "1.0",
                "-an",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(square),
            ],
            check=True,
        )
        compose_fal_wide(square, source, output, arguments.ffmpeg)

        capture = cv2.VideoCapture(str(output))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = capture.get(cv2.CAP_PROP_FPS)
        frames = round(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        capture.release()
        if (width, height) != (1920, 1080) or not 24 <= fps <= 26 or frames < 1:
            raise RuntimeError(
                f"frozen Fal render geometry drifted: {width}x{height} {fps:g}fps {frames} frames"
            )
        print(f"frozen/render smoke geometry={width}x{height} fps={fps:g} frames={frames}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
