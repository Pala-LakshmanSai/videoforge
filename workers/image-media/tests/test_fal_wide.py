"""The cached warp must preserve the accepted crop geometry and native detail."""

import unittest
import hashlib
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

import cv2
import numpy as np

from videoforge_image_media.jobs.render.fal_wide import (
    _LowerCropAnchor, _blend_mask, _clipped_crop_bounds, _fit_similarity,
    _perspective_maps, _register_crop, _WideFrameComposer, prepare_fal_source,
)


class FalWideMappingTests(unittest.TestCase):
    def test_prepared_source_decodes_the_exact_hashed_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.png"
            image = np.random.default_rng(7).integers(0, 256, (540, 960, 3), dtype=np.uint8)
            cv2.imwrite(str(source), image)
            encoded = source.read_bytes()
            expected = cv2.resize(cv2.imread(str(source)), (1920, 1080),
                                  interpolation=cv2.INTER_AREA)
            original_decode = cv2.imdecode
            original_hash = hashlib.sha256
            hash_inputs = []
            decode_inputs = []

            def check_hash(value):
                hash_inputs.append(value)
                return original_hash(value)

            def check_decode(value, flags):
                decode_inputs.append(value.tobytes())
                return original_decode(value, flags)

            with patch("cv2.imread", side_effect=AssertionError("Source reopened")), \
                    patch("hashlib.sha256", side_effect=check_hash), \
                    patch("cv2.imdecode", side_effect=check_decode):
                prepared = prepare_fal_source(source)
            self.assertEqual(hash_inputs, [encoded])
            self.assertEqual(decode_inputs, [encoded])
            np.testing.assert_array_equal(prepared.background, expected)

    def test_prepared_source_rejects_same_size_mutation_during_decode(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.png"
            image = np.random.default_rng(8).integers(0, 256, (540, 960, 3), dtype=np.uint8)
            cv2.imwrite(str(source), image)
            encoded = source.read_bytes()
            original_decode = cv2.imdecode

            def changed_source(value, flags):
                source.write_bytes(b"x" * len(encoded))
                return original_decode(value, flags)

            with patch("cv2.imdecode", side_effect=changed_source), \
                    self.assertRaisesRegex(ValueError, "identity drifted"):
                prepare_fal_source(source)

    def test_empty_source_retains_unreadable_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "empty.png"
            source.write_bytes(b"")
            with self.assertRaisesRegex(ValueError, "unreadable"):
                prepare_fal_source(source)

    def test_prepared_source_verifies_identity_and_rejects_replacement(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.png"
            other = Path(temporary) / "other.png"
            image = np.random.default_rng(6).integers(0, 256, (540, 960, 3), dtype=np.uint8)
            cv2.imwrite(str(source), image)
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            prepared = prepare_fal_source(source, source_sha256="sha256:" + digest)
            self.assertEqual(prepared.identity, (source.resolve(), digest))
            prepared.validate_source(source)
            self.assertFalse(prepared.background.flags.writeable)
            self.assertFalse(prepared.source_features[1].flags.writeable)
            self.assertFalse(prepared.blend_mask.flags.writeable)
            with self.assertRaisesRegex(ValueError, "checksum mismatched"):
                prepare_fal_source(source, source_sha256="0" * 64)
            other.write_bytes(source.read_bytes())
            with self.assertRaisesRegex(ValueError, "identity drifted"):
                prepared.validate_source(other)
            source.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "identity drifted"):
                prepared.validate_source(source)

    def test_source_feature_reuse_preserves_registration(self) -> None:
        background = np.random.default_rng(19).integers(0, 256, (1080, 1920, 3), dtype=np.uint8)
        detector = cv2.ORB_create(nfeatures=5000)
        features = detector.detectAndCompute(cv2.cvtColor(background, cv2.COLOR_BGR2GRAY), None)
        first = Mock()
        second = Mock()
        first.read.return_value = second.read.return_value = (True, background[200:712, 600:1112])
        expected, expected_bounds = _register_crop(first, background)
        actual, actual_bounds = _register_crop(second, background, source_features=features)
        np.testing.assert_array_equal(actual, expected)
        self.assertEqual(actual_bounds, expected_bounds)

    def test_reused_buffers_match_original_pixels_and_reset_clip_state(self) -> None:
        background = cv2.GaussianBlur(
            np.random.default_rng(27).integers(0, 256, (1080, 1920, 3), dtype=np.uint8), (5, 5), 0
        )
        for registration in (np.array([[1, 0, 600], [0, 1, 200], [0, 0, 1]], dtype=float),
                             np.array([[1.3, -.03, 450], [.03, 1.3, -30], [0, 0, 1]])):
            corners = cv2.perspectiveTransform(
                np.float32([[[0, 0], [512, 0], [512, 512], [0, 512]]]), registration.astype(float)
            )[0]
            x0, y0 = np.floor(corners.min(axis=0)).astype(int)
            x1, y1 = np.ceil(corners.max(axis=0)).astype(int)
            bounds = _clipped_crop_bounds(x0, y0, x1, y1)
            x0, y0, x1, y1 = bounds
            transform = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]]) @ registration
            size = (x1 - x0, y1 - y0)
            reference = cv2.warpPerspective(background, np.linalg.inv(registration), (512, 512))
            anchor = _LowerCropAnchor(reference)
            maps = _perspective_maps(transform, size)
            alpha = cv2.warpPerspective(_blend_mask(), transform, size)[:, :, None]
            backdrop = background[y0:y1, x0:x1].astype(np.float32) * (1 - alpha)
            composer = _WideFrameComposer(background, registration, bounds, _blend_mask())
            frames = [cv2.warpAffine(reference, np.float32([[1, 0, dx], [0, 1, dy]]),
                                    (512, 512), borderMode=cv2.BORDER_REFLECT)
                      for dx, dy in [(0, 0), (9, -4), (-7, 5)]]
            expected_first = None
            for frame in frames:
                original = frame.copy()
                warped = cv2.remap(anchor.apply(frame), *maps, cv2.INTER_CUBIC)
                expected = background.copy()
                expected[y0:y1, x0:x1] = (warped.astype(np.float32) * alpha + backdrop).astype(np.uint8)
                actual = composer.apply(frame)
                np.testing.assert_array_equal(actual, expected)
                np.testing.assert_array_equal(frame, original)
                if expected_first is None:
                    expected_first = expected
            fresh = _WideFrameComposer(background, registration, bounds, _blend_mask())
            np.testing.assert_array_equal(fresh.apply(frames[0]), expected_first)

    def test_lower_join_tracks_collar_without_changing_face_or_input(self) -> None:
        reference = np.zeros((512, 512, 3), dtype=np.uint8)
        random = np.random.default_rng(42)
        reference[:] = cv2.GaussianBlur(
            random.integers(0, 256, reference.shape, dtype=np.uint8), (5, 5), 0
        )
        cv2.line(reference, (180, 420), (250, 511), (255, 255, 255), 12)
        cv2.line(reference, (320, 420), (250, 511), (255, 255, 255), 12)
        for dx, dy in [(10, -6), (-8, 5), (0, 0)]:
            with self.subTest(dx=dx, dy=dy):
                moving = cv2.warpAffine(reference, np.float32([[1, 0, dx], [0, 1, dy]]),
                                        (512, 512), borderMode=cv2.BORDER_REFLECT)
                original = moving.copy()
                fixed = _LowerCropAnchor(reference).apply(moving)
                np.testing.assert_array_equal(moving, original)
                np.testing.assert_array_equal(fixed[:384], moving[:384])
                region = np.s_[480:504, 100:400]
                before = np.abs(moving[region].astype(float) - reference[region]).mean()
                after = np.abs(fixed[region].astype(float) - reference[region]).mean()
                self.assertLess(after, max(1, before * 0.3))

    def test_registration_preserves_face_proportions_and_rejects_weak_fit(self) -> None:
        x, y = np.meshgrid(np.arange(0, 512, 64), np.arange(0, 512, 64))
        source = np.stack((x, y), axis=-1).astype(np.float32).reshape(-1, 1, 2)
        expected = np.array([[1.5, -0.2, 500], [0.2, 1.5, 20], [0, 0, 1]])
        target = cv2.perspectiveTransform(source, expected).astype(np.float32)
        target[0] += 80  # One bad feature must not stretch the face.
        actual = _fit_similarity(source, target)
        np.testing.assert_allclose(actual, expected, atol=0.01)
        with self.assertRaisesRegex(ValueError, "geometry is uncertain"):
            _fit_similarity(source[:10], target[:10])

    def test_moving_alignment_frame_falls_back_to_source_frame(self) -> None:
        random = np.random.default_rng(21)
        background = random.integers(0, 256, (1080, 1920, 3), dtype=np.uint8)
        source_frame = background[200:712, 600:1112].copy()
        capture = Mock()
        capture.read.side_effect = [(True, np.zeros_like(source_frame)), (True, source_frame)]
        transform, bounds = _register_crop(capture, background)
        np.testing.assert_allclose(transform, [[1, 0, 600], [0, 1, 200], [0, 0, 1]], atol=0.1)
        self.assertLessEqual(abs(bounds[0] - 600), 1)
        self.assertLessEqual(abs(bounds[1] - 200), 1)
        self.assertEqual([call.args[1] for call in capture.set.call_args_list], [500, 0])

    def test_all_uncertain_frames_remain_terminal(self) -> None:
        background = np.random.default_rng(21).integers(0, 256, (1080, 1920, 3), dtype=np.uint8)
        capture = Mock()
        capture.read.return_value = (True, np.zeros((512, 512, 3), dtype=np.uint8))
        with self.assertRaisesRegex(ValueError, "no source features"):
            _register_crop(capture, background)
        self.assertEqual(capture.read.call_count, 4)

    def test_blend_keeps_shoulder_and_neck_single(self) -> None:
        mask = _blend_mask()
        self.assertGreater(mask[450, 256], 0.9)  # Keep moving shirt at center.
        self.assertEqual(mask[450, 20], 0)  # Side join stays inside shirt.
        self.assertGreater(mask[500, 256], mask[500, 70])  # Fade lower hair, not neck.

    def test_small_edge_overrun_clips_without_changing_registered_scale(self) -> None:
        # Real clip 39 projects 58 pixels above the source, with strong feature registration.
        self.assertEqual(_clipped_crop_bounds(478, -58, 1400, 822), (478, 0, 1400, 822))
        # Real clip 60 projects 188 pixels above; 82% of its crop remains on source.
        self.assertEqual(_clipped_crop_bounds(324, -188, 1393, 854), (324, 0, 1393, 854))
        with self.assertRaisesRegex(ValueError, "Fal crop maps outside the pinned source"):
            _clipped_crop_bounds(324, -193, 1393, 849)
        with self.assertRaisesRegex(ValueError, "Fal crop maps outside the pinned source"):
            _clipped_crop_bounds(324, -188, 1393, 700)
        with self.assertRaisesRegex(ValueError, "Fal crop maps outside the pinned source"):
            _clipped_crop_bounds(-33, 100, 900, 950)
        with self.assertRaisesRegex(ValueError, "Fal crop maps outside the pinned source"):
            _clipped_crop_bounds(0, 0, 1200, 900)

    def test_cached_cubic_mapping_matches_perspective_with_clipped_origin(self) -> None:
        random = np.random.default_rng(17)
        image = random.integers(0, 256, (80, 80, 3), dtype=np.uint8)
        transform = np.array([[1.7, -.04, 11], [.02, 1.6, -8], [.00003, -.00004, 1]])
        size = (150, 130)
        actual = cv2.remap(image, *_perspective_maps(transform, size), cv2.INTER_CUBIC)
        expected = cv2.warpPerspective(image, transform, size, flags=cv2.INTER_CUBIC)
        error = np.abs(actual.astype(float) - expected.astype(float))
        # Both use 1/32 pixel interpolation; float map quantization can differ at a boundary.
        self.assertLess(float(error.mean()), .1)
        self.assertLessEqual(float(error.max()), 12)

    def test_identity_mapping_keeps_pixels_exact(self) -> None:
        image = np.random.default_rng(4).integers(0, 256, (64, 64, 3), dtype=np.uint8)
        actual = cv2.remap(image, *_perspective_maps(np.eye(3), (64, 64)), cv2.INTER_CUBIC)
        np.testing.assert_array_equal(actual, image)


if __name__ == "__main__":
    unittest.main()
