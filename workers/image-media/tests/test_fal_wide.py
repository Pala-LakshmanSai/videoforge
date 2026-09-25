"""The cached warp must preserve the accepted crop geometry and native detail."""

import unittest

import cv2
import numpy as np

from videoforge_image_media.jobs.render.fal_wide import _perspective_maps


class FalWideMappingTests(unittest.TestCase):
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
