from __future__ import annotations

import json
import time

import infer_flash
import torch
from torchao.quantization import float8_dynamic_activation_float8_weight, quantize_


def _install_fp8_transformer_load() -> None:
    original_from_pretrained = infer_flash.WanTransformer.from_pretrained

    def from_pretrained_then_fp8(*args, **kwargs):
        transformer = original_from_pretrained(*args, **kwargs)
        original_load = transformer.load_state_dict

        def load_flash_then_fp8(state_dict, *load_args, **load_kwargs):
            result = original_load(state_dict, *load_args, **load_kwargs)
            transformer.load_state_dict = original_load
            transformer._videoforge_fp8_pending = True
            print(
                json.dumps(
                    {
                        "event": "echomimic_fp8_checkpoint_loaded",
                        "format": "float8_e4m3fn_dynamic_activation_weight",
                    },
                    sort_keys=True,
                ),
                flush=True,
            )
            return result

        transformer.load_state_dict = load_flash_then_fp8
        return transformer

    infer_flash.WanTransformer.from_pretrained = from_pretrained_then_fp8


def _install_generation_timing() -> None:
    original = infer_flash.WanFunInpaintAudioPipeline.__call__

    def call_long_video(self, *args, **kwargs):
        if not getattr(self.transformer, "_videoforge_fp8_pending", False):
            raise RuntimeError("ECHOMIMIC_FP8_CHECKPOINT_NOT_READY")
        quantize_(self.transformer, float8_dynamic_activation_float8_weight())
        self.transformer._videoforge_fp8_pending = False
        quantized = sum(
            1
            for module in self.transformer.modules()
            if isinstance(module, torch.nn.Linear)
            and type(module.weight).__module__.startswith("torchao.")
        )
        if quantized < 1:
            raise RuntimeError("ECHOMIMIC_FP8_QUANTIZATION_EMPTY")
        print(
            json.dumps(
                {
                    "event": "echomimic_fp8_ready",
                    "format": "float8_e4m3fn_dynamic_activation_weight",
                    "quantized_linear_count": quantized,
                },
                sort_keys=True,
            ),
            flush=True,
        )
        print(
            json.dumps(
                {
                    "event": "echomimic_full_video_fp8",
                    "num_frames": kwargs.get("num_frames"),
                },
                sort_keys=True,
            ),
            flush=True,
        )
        started = time.monotonic()
        result = original(self, *args, **kwargs)
        print(
            json.dumps(
                {
                    "duration_ms": round((time.monotonic() - started) * 1000),
                    "event": "echomimic_generation_complete",
                },
                sort_keys=True,
            ),
            flush=True,
        )
        return result

    infer_flash.WanFunInpaintAudioPipeline.__call__ = call_long_video


def main() -> None:
    _install_fp8_transformer_load()
    _install_generation_timing()
    infer_flash.main()


if __name__ == "__main__":
    main()
