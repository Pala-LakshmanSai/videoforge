"""Restore a Fal FlashHead square crop to its pinned wide source image."""

from __future__ import annotations

import subprocess
from pathlib import Path


def _perspective_maps(transform, size):
    """Cache the unchanged inverse mapping for every frame in one clip."""
    import cv2
    import numpy as np

    yy, xx = np.indices((size[1], size[0]), dtype=np.float32)
    coordinates = cv2.perspectiveTransform(np.stack((xx, yy), axis=-1), np.linalg.inv(transform))
    return cv2.convertMaps(coordinates, None, cv2.CV_16SC2)


def _clipped_crop_bounds(x0: int, y0: int, x1: int, y1: int) -> tuple[int, int, int, int]:
    width, height = x1 - x0, y1 - y0
    clipped = max(0, x0), max(0, y0), min(1920, x1), min(1080, y1)
    clipped_width = clipped[2] - clipped[0]
    clipped_height = clipped[3] - clipped[1]
    if (
        max(-x0, x1 - 1920, y1 - 1080) > 32
        or -y0 > 192
        or not (300 < width < 1200 and 300 < height < 1200)
        or clipped_width <= 0 or clipped_height <= 0
        or 5 * clipped_width * clipped_height < 4 * width * height
    ):
        raise ValueError("Fal crop maps outside the pinned source")
    # Keep the registered scale; clip only the small part outside the source canvas.
    return clipped


def compose_fal_wide(square: Path, source: Path, output: Path, ffmpeg: Path) -> None:
    """Register the native crop using source features; fail if geometry is uncertain."""
    import cv2
    import numpy as np

    background = cv2.imread(str(source), cv2.IMREAD_COLOR)
    if background is None:
        raise ValueError("Fal source image is unreadable")
    background = cv2.resize(background, (1920, 1080), interpolation=cv2.INTER_AREA)
    capture = cv2.VideoCapture(str(square))
    if not capture.isOpened():
        raise ValueError("Fal square clip is unreadable")
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, 500)
        ok, sample = capture.read()
        fps = capture.get(cv2.CAP_PROP_FPS)
        if not ok or not 24 <= fps <= 26:
            raise ValueError("Fal square clip has no alignment frame or wrong frame rate")
        square_height, square_width = sample.shape[:2]
        if (square_width, square_height) != (512, 512):
            raise ValueError("Fal square clip geometry drifted")
        native_frame_count = round(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        detector = cv2.ORB_create(nfeatures=5000)
        source_points, source_descriptors = detector.detectAndCompute(
            cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY), None
        )
        background_points, background_descriptors = detector.detectAndCompute(
            cv2.cvtColor(background, cv2.COLOR_BGR2GRAY), None
        )
        if source_descriptors is None or background_descriptors is None:
            raise ValueError("Fal crop has no source features")
        pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(
            source_descriptors, background_descriptors, k=2
        )
        matches = [first for first, second in pairs if first.distance < 0.75 * second.distance]
        if len(matches) < 25:
            raise ValueError("Fal crop has too few source matches")
        src = np.float32([source_points[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        dst = np.float32([background_points[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        homography, inliers = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
        if homography is None or inliers is None or int(inliers.sum()) < 20:
            raise ValueError("Fal crop source geometry is uncertain")
        corners = cv2.perspectiveTransform(
            np.float32([[[0, 0], [512, 0], [512, 512], [0, 512]]]), homography
        )[0]
        x0, y0 = np.floor(corners.min(axis=0)).astype(int)
        x1, y1 = np.ceil(corners.max(axis=0)).astype(int)
        x0, y0, x1, y1 = _clipped_crop_bounds(x0, y0, x1, y1)
        transform = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]]) @ homography
        region_width, region_height = x1 - x0, y1 - y0
        maps = _perspective_maps(transform, (region_width, region_height))
        yy, xx = np.mgrid[0:512, 0:512]
        mask = np.minimum.reduce([xx, yy, 511 - xx, 511 - yy]).astype(np.float32)
        alpha = cv2.warpPerspective(np.clip(mask / 60, 0, 1), transform,
                                    (region_width, region_height))[:, :, None]
        backdrop = background[y0:y1, x0:x1].astype(np.float32) * (1 - alpha)

        command = [str(ffmpeg), "-v", "error", "-nostdin", "-n", "-f", "rawvideo",
                   "-pixel_format", "bgr24", "-video_size", "1920x1080", "-framerate", "25",
                   "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "veryfast",
                   "-crf", "18", "-pix_fmt", "yuv420p", "-threads", "2", str(output)]
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
        frame_count = 0
        last_wide = None
        wide = background.copy()
        try:
            assert process.stdin is not None and process.stderr is not None
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                warped = cv2.remap(frame, *maps, cv2.INTER_CUBIC)
                wide[y0:y1, x0:x1] = (warped.astype(np.float32) * alpha + backdrop).astype(np.uint8)
                process.stdin.write(memoryview(wide))
                last_wide = wide
                frame_count += 1
            missing_frames = native_frame_count - frame_count
            if missing_frames < 0 or missing_frames > 3 or last_wide is None:
                raise ValueError("Fal square clip decode lost too many frames")
            for _ in range(missing_frames):
                process.stdin.write(memoryview(last_wide))
                frame_count += 1
            process.stdin.close()
            error = process.stderr.read().decode("utf-8", errors="replace")
            if process.wait() != 0 or frame_count < 1:
                raise ValueError(f"Fal wide composition failed: {error[-300:]}")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    finally:
        capture.release()
