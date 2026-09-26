"""Restore a Fal FlashHead square crop to its pinned wide source image."""

from __future__ import annotations

import hashlib
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from videoforge_image_media.subprocess_options import background_creationflags


@dataclass(frozen=True)
class PreparedFalSource:
    """Immutable pinned-image work reusable only within one render job.

    Registration, optical-flow state and output buffers remain private to each clip.
    """

    source_path: Path
    source_sha256: str
    size_bytes: int
    modified_ns: int
    background: object
    source_features: tuple
    blend_mask: object

    @property
    def identity(self) -> tuple[Path, str]:
        return self.source_path, self.source_sha256

    def validate_source(self, source: Path) -> None:
        stat = source.stat()
        if (source.resolve() != self.source_path
                or stat.st_size != self.size_bytes or stat.st_mtime_ns != self.modified_ns):
            raise ValueError("Fal prepared source identity drifted")


def prepare_fal_source(source: Path, *, source_sha256: str | None = None) -> PreparedFalSource:
    """Prepare a verified source once; callers own and discard it with their job."""
    import cv2
    import numpy as np

    source = source.resolve()
    with source.open("rb") as stream:
        before = os.fstat(stream.fileno())
        encoded = stream.read()
        read_stat = os.fstat(stream.fileno())
    def source_facts(stat):
        return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns

    if source_facts(before) != source_facts(read_stat) or len(encoded) != before.st_size:
        raise ValueError("Fal prepared source identity drifted")
    if source_facts(before) != source_facts(source.stat()):
        raise ValueError("Fal prepared source identity drifted")
    digest = hashlib.sha256(encoded).hexdigest()
    if source_sha256 is not None and digest != source_sha256.removeprefix("sha256:"):
        raise ValueError("Fal prepared source checksum mismatched")
    if not encoded:
        raise ValueError("Fal source image is unreadable")
    # Decode the exact checked bytes rather than reopening a path after hashing.
    background = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)
    del encoded
    if background is None:
        raise ValueError("Fal source image is unreadable")
    background = cv2.resize(background, (1920, 1080), interpolation=cv2.INTER_AREA)
    detector = cv2.ORB_create(nfeatures=5000)
    points, descriptors = detector.detectAndCompute(
        cv2.cvtColor(background, cv2.COLOR_BGR2GRAY), None
    )
    if descriptors is None:
        raise ValueError("Fal crop has no source features")
    after = source.stat()
    if source_facts(before) != source_facts(after):
        raise ValueError("Fal prepared source identity drifted")
    mask = _blend_mask()
    for array in (background, descriptors, mask):
        array.setflags(write=False)
    return PreparedFalSource(source, digest, after.st_size, after.st_mtime_ns,
                             background, (tuple(points), descriptors), mask)


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

    def apply(self, frame, *, output=None):
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
        result = frame.copy() if output is None else output
        if output is not None:
            np.copyto(result, frame)
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


def _register_crop(capture, background, *, source_features=None):
    """Try bounded alignment frames without weakening source or crop checks."""
    import cv2
    import numpy as np

    detector = cv2.ORB_create(nfeatures=5000)
    if source_features is None:
        source_features = detector.detectAndCompute(
            cv2.cvtColor(background, cv2.COLOR_BGR2GRAY), None
        )
    background_points, background_descriptors = source_features
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


class _WideFrameComposer:
    """Own bounded scratch buffers and collar-flow state for exactly one clip."""

    def __init__(self, background, registration, bounds, blend_mask):
        import cv2
        import numpy as np

        self.x0, self.y0, self.x1, self.y1 = bounds
        transform = np.array([[1, 0, -self.x0], [0, 1, -self.y0], [0, 0, 1]]) @ registration
        region_width, region_height = self.x1 - self.x0, self.y1 - self.y0
        self.maps = _perspective_maps(transform, (region_width, region_height))
        reference = cv2.warpPerspective(background, np.linalg.inv(registration), (512, 512))
        self.lower_anchor = _LowerCropAnchor(reference)
        self.alpha = cv2.warpPerspective(blend_mask, transform,
                                        (region_width, region_height))[:, :, None]
        self.backdrop = background[self.y0:self.y1, self.x0:self.x1].astype(np.float32) * (1 - self.alpha)
        self.wide = background.copy()
        self.anchored = np.empty((512, 512, 3), dtype=np.uint8)
        self.warped = np.empty((region_height, region_width, 3), dtype=np.uint8)
        self.blended = np.empty((region_height, region_width, 3), dtype=np.float32)

    def apply(self, frame):
        import cv2
        import numpy as np

        frame = self.lower_anchor.apply(frame, output=self.anchored)
        cv2.remap(frame, *self.maps, cv2.INTER_CUBIC, dst=self.warped)
        np.multiply(self.warped, self.alpha, out=self.blended, dtype=np.float32)
        np.add(self.blended, self.backdrop, out=self.blended)
        np.copyto(self.wide[self.y0:self.y1, self.x0:self.x1], self.blended, casting="unsafe")
        return self.wide


def compose_fal_wide(square: Path, source: Path, output: Path, ffmpeg: Path,
                     *, prepared_source: PreparedFalSource | None = None) -> None:
    """Register the native crop using source features; fail if geometry is uncertain."""
    import cv2

    prepared_source = prepared_source or prepare_fal_source(source)
    prepared_source.validate_source(source)
    background = prepared_source.background
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
        registration, bounds = _register_crop(
            capture, background, source_features=prepared_source.source_features
        )
        composer = _WideFrameComposer(background, registration, bounds, prepared_source.blend_mask)

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
        try:
            assert process.stdin is not None and process.stderr is not None
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                wide = composer.apply(frame)
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
