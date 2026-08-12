from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


class FakeLinear:
    def __init__(self) -> None:
        self.weight = types.SimpleNamespace()


class FakeTransformer:
    @classmethod
    def from_pretrained(cls, *_args, **_kwargs):
        return cls()

    def __init__(self) -> None:
        self.linear = FakeLinear()

    def load_state_dict(self, _state_dict, *args, **kwargs):
        return "loaded"

    def modules(self):
        return [self.linear]


class FakePipeline:
    def __init__(self, transformer=None) -> None:
        self.transformer = transformer or FakeTransformer()

    def __call__(self, *args, **kwargs):
        return kwargs


class Fp8WrapperTest(unittest.TestCase):
    def setUp(self) -> None:
        self.quantize_calls: list[object] = []
        self.original_transformer_from_pretrained = FakeTransformer.__dict__["from_pretrained"]
        self.original_pipeline_call = FakePipeline.__call__

        def quantize(model, _config) -> None:
            self.quantize_calls.append(model)
            quantized_weight = type("QuantizedWeight", (), {})
            quantized_weight.__module__ = "torchao.fake"
            model.linear.weight = quantized_weight()

        self.fake_infer = types.SimpleNamespace(
            WanTransformer=FakeTransformer,
            WanFunInpaintAudioPipeline=FakePipeline,
            main=lambda: None,
        )
        self.previous = {
            name: sys.modules.get(name)
            for name in ("infer_flash", "torch", "torchao", "torchao.quantization")
        }
        sys.modules["infer_flash"] = self.fake_infer  # type: ignore[assignment]
        sys.modules["torch"] = types.SimpleNamespace(  # type: ignore[assignment]
            nn=types.SimpleNamespace(Linear=FakeLinear)
        )
        sys.modules["torchao"] = types.ModuleType("torchao")
        quantization = types.ModuleType("torchao.quantization")
        quantization.float8_dynamic_activation_float8_weight = lambda: "fp8"
        quantization.quantize_ = quantize
        sys.modules["torchao.quantization"] = quantization

        path = Path(__file__).resolve().parents[1] / "infer_flash_fp8.py"
        spec = importlib.util.spec_from_file_location("avatar_primary_fp8_wrapper", path)
        assert spec and spec.loader
        self.wrapper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.wrapper)

    def tearDown(self) -> None:
        FakeTransformer.from_pretrained = self.original_transformer_from_pretrained
        FakePipeline.__call__ = self.original_pipeline_call
        sys.modules.pop("avatar_primary_fp8_wrapper", None)
        for name, module in self.previous.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module

    def test_quantizes_only_after_pipeline_device_transfers(self) -> None:
        self.wrapper._install_fp8_transformer_load()
        self.wrapper._install_long_video_cfg()
        transformer = FakeTransformer.from_pretrained("base")
        self.assertEqual(transformer.load_state_dict({}), "loaded")
        self.assertEqual(self.quantize_calls, [])
        FakePipeline(transformer)()
        self.assertEqual(self.quantize_calls, [transformer])
        self.assertEqual(transformer.load_state_dict({}), "loaded")
        self.assertEqual(self.quantize_calls, [transformer])

    def test_forces_bounded_long_video_cfg(self) -> None:
        self.wrapper._install_long_video_cfg()
        transformer = FakeTransformer()
        transformer._videoforge_fp8_pending = True
        result = FakePipeline(transformer)(num_frames=253)
        self.assertEqual(result["num_frames"], 253)
        self.assertIs(result["use_longvideo_cfg"], True)
        self.assertEqual(result["partial_video_length"], 81)
        self.assertEqual(result["overlap_video_length"], 5)


if __name__ == "__main__":
    unittest.main()
