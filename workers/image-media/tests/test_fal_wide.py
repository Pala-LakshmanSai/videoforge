"""The cached warp must preserve the accepted crop geometry and native detail."""

import unittest

import cv2
import numpy as np

from videoforge_image_media.jobs.render.fal_wide import (
    _blend_mask, _clipped_crop_bounds, _fit_similarity, _perspective_maps,
)


class FalWideMappingTests(unittest.TestCase):
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
