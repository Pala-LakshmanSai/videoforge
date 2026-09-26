"""Restore a Fal FlashHead square crop to its pinned wide source image."""

from __future__ import annotations

import subprocess
from pathlib import Path

from videoforge_image_media.subprocess_options import background_creationflags


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


def _blend_mask():
    """Keep the lower side seam inside the shirt and fade lower hair separately."""
    import numpy as np

    yy, xx = np.mgrid[0:512, 0:512]
    inset = np.clip((yy / 512 - 0.508) / 0.234, 0, 1) * (512 * 0.156)
    side = np.minimum((xx - inset) / (512 * 0.039),
                      (511 - xx - inset) / (512 * 0.039))
    hair = np.clip((np.abs(xx - 256) / 512 - 0.117) / 0.156, 0, 1)
    bottom = 32 + 48 * hair
    vertical = np.minimum(yy / (512 * 0.016), (511 - yy) / bottom)
    return np.clip(np.minimum(side, vertical), 0, 1).astype(np.float32)


class _LowerCropAnchor:
    """Join the moving collar to the still torso without crossfading two collars."""

    def __init__(self, reference):
        import cv2
        import numpy as np

        self.reference = cv2.cvtColor(
            cv2.resize(reference[320:], (256, 96), interpolation=cv2.INTER_AREA),
            cv2.COLOR_BGR2GRAY,
        )
        self.flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self.yy, self.xx = np.mgrid[384:512, 0:512].astype(np.float32)
        weight = np.clip((self.yy - 384) / 96, 0, 1)
        self.weight = weight * weight * (3 - 2 * weight)

    def apply(self, frame):
        import cv2
        import numpy as np

        moving = cv2.cvtColor(
            cv2.resize(frame[320:], (256, 96), interpolation=cv2.INTER_AREA),
            cv2.COLOR_BGR2GRAY,
        )
        # Reference-to-frame flow samples the moving pixels at the still collar's
        # position. Work only near the lower join; speech/face pixels stay intact.
        flow = self.flow.calc(self.reference, moving, None)
        flow = cv2.resize(flow, (512, 192), interpolation=cv2.INTER_LINEAR) * 2
        flow = cv2.GaussianBlur(flow, (0, 0), 3)[64:]
        # Bound deformation even when texture is weak or generation changes clothing.
        flow = np.clip(np.nan_to_num(flow), -24, 24) * self.weight[:, :, None]
        lower = cv2.remap(frame, self.xx + flow[:, :, 0], self.yy + flow[:, :, 1],
                          cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        result = frame.copy()
        result[384:] = lower
        return result


def _fit_similarity(src, dst):
    """Register without stretching either face axis independently."""
    import cv2
    import numpy as np

    affine, inliers = cv2.estimateAffinePartial2D(
        src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0
    )
    if affine is None or inliers is None or int(inliers.sum()) < 20:
        raise ValueError("Fal crop source geometry is uncertain")
    transform = np.vstack((affine, [0, 0, 1]))
    fitted = cv2.perspectiveTransform(src, transform).reshape(-1, 2)
    residual = np.linalg.norm(fitted - dst.reshape(-1, 2), axis=1)
    if np.percentile(residual[inliers.ravel() != 0], 95) > 3:
        raise ValueError("Fal crop source geometry is uncertain")
    return transform


def _register_crop(capture, background):
    """Try bounded alignment frames without weakening source or crop checks."""
    import cv2
    import numpy as np

    detector = cv2.ORB_create(nfeatures=5000)
    background_points, background_descriptors = detector.detectAndCompute(
        cv2.cvtColor(background, cv2.COLOR_BGR2GRAY), None
    )
    if background_descriptors is None:
        raise ValueError("Fal crop has no source features")
    first_failure = None
    # Speech can move source features at 500ms. The initial frame often retains them.
    for sample_ms in (500, 0, 200, 1000):
        capture.set(cv2.CAP_PROP_POS_MSEC, sample_ms)
        ok, sample = capture.read()
        if not ok:
            continue
        if sample.shape[:2] != (512, 512):
            raise ValueError("Fal square clip geometry drifted")
        try:
            source_points, source_descriptors = detector.detectAndCompute(
                cv2.cvtColor(sample, cv2.COLOR_BGR2GRAY), None
            )
            if source_descriptors is None:
                raise ValueError("Fal crop has no source features")
            pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(
                source_descriptors, background_descriptors, k=2
            )
            matches = [first for first, second in pairs
                       if first.distance < 0.75 * second.distance]
            if len(matches) < 25:
                raise ValueError("Fal crop has too few source matches")
            src = np.float32([source_points[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
            dst = np.float32([background_points[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
            registration = _fit_similarity(src, dst)
            corners = cv2.perspectiveTransform(
                np.float32([[[0, 0], [512, 0], [512, 512], [0, 512]]]), registration
            )[0]
            x0, y0 = np.floor(corners.min(axis=0)).astype(int)
            x1, y1 = np.ceil(corners.max(axis=0)).astype(int)
            bounds = _clipped_crop_bounds(x0, y0, x1, y1)
            return registration, bounds
        except ValueError as error:
            if first_failure is None:
                first_failure = error
    raise first_failure or ValueError("Fal square clip has no alignment frame or wrong frame rate")


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
        registration, (x0, y0, x1, y1) = _register_crop(capture, background)
        transform = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]]) @ registration
        region_width, region_height = x1 - x0, y1 - y0
        maps = _perspective_maps(transform, (region_width, region_height))
        reference = cv2.warpPerspective(background, np.linalg.inv(registration), (512, 512))
        lower_anchor = _LowerCropAnchor(reference)
        alpha = cv2.warpPerspective(_blend_mask(), transform,
                                    (region_width, region_height))[:, :, None]
        backdrop = background[y0:y1, x0:x1].astype(np.float32) * (1 - alpha)

        command = [str(ffmpeg), "-v", "error", "-nostdin", "-n", "-f", "rawvideo",
                   "-pixel_format", "bgr24", "-video_size", "1920x1080", "-framerate", "25",
                   "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "veryfast",
                   "-crf", "18", "-pix_fmt", "yuv420p", "-threads", "2", str(output)]
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=background_creationflags(),
        )
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
                frame = lower_anchor.apply(frame)
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
