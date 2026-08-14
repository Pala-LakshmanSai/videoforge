from __future__ import annotations

import json
import math
import struct
import wave
from pathlib import Path

from echo_volume import ECHO_PREPARED_STATE_PATH, ECHO_TORCHAO_VERSION, ECHO_TORCH_VERSION


class EchoPreparedBackend:
    """Resident upstream Flash pipeline loaded from the owned prepared state.

    The implementation follows pinned Apache-2.0 `infer_flash.py` at
    7e89489ca51c0d008fc1963ec6c03fc5bd0b9397. It intentionally omits every long-video path.
    """

    def __init__(self, model_root: Path) -> None:
        self.model_root = model_root
        self.pipeline = None
        self.audio_encoder = None
        self.wav2vec_feature_extractor = None
        self.device = None
        self.upstream = None

    def load(self) -> dict[str, object]:
        try:
            import infer_flash as upstream
            import torch
            import torchao
            from accelerate import init_empty_weights
            from omegaconf import OmegaConf
            from transformers import AutoTokenizer, Wav2Vec2FeatureExtractor
            from src.wav2vec2 import Wav2Vec2Model
        except Exception as error:
            raise RuntimeError("ECHO_RUNTIME_TOOLCHAIN_UNAVAILABLE") from error
        if str(torch.__version__).split("+")[0] != ECHO_TORCH_VERSION:
            raise RuntimeError("ECHO_RUNTIME_TORCH_MISMATCH")
        if str(torchao.__version__) != ECHO_TORCHAO_VERSION:
            raise RuntimeError("ECHO_RUNTIME_TORCHAO_MISMATCH")
        config = OmegaConf.load("/opt/echomimic_v3/config/config.yaml")
        base = self.model_root / "source/base"
        audio = self.model_root / "source/audio"
        prepared = self.model_root / ECHO_PREPARED_STATE_PATH
        self.audio_encoder = Wav2Vec2Model.from_pretrained(str(audio), local_files_only=True).to(
            "cpu"
        )
        self.audio_encoder.feature_extractor._freeze_parameters()
        self.wav2vec_feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(
            str(audio), local_files_only=True
        )
        selected_device = torch.device(upstream.set_multi_gpus_devices(1, 1))
        if selected_device.type != "cuda" or torch.cuda.device_count() != 1:
            raise RuntimeError("ECHO_RUNTIME_GPU_TOPOLOGY_MISMATCH")
        self.device = torch.device("cuda", torch.cuda.current_device())
        transformer_root = base / config["transformer_additional_kwargs"].get(
            "transformer_subpath", "transformer"
        )
        transformer_config = json.loads((transformer_root / "config.json").read_text())
        transformer_kwargs = OmegaConf.to_container(config["transformer_additional_kwargs"])
        mapping = transformer_kwargs.get("dict_mapping", {})
        for source_key, destination_key in mapping.items():
            transformer_kwargs[destination_key] = transformer_config[source_key]
        with init_empty_weights():
            transformer = upstream.WanTransformer.from_config(
                transformer_config, **transformer_kwargs
            )
        vae = upstream.AutoencoderKLWan.from_pretrained(
            str(base / config["vae_kwargs"].get("vae_subpath", "vae")),
            additional_kwargs=OmegaConf.to_container(config["vae_kwargs"]),
        ).to(torch.bfloat16)
        tokenizer = AutoTokenizer.from_pretrained(
            str(base / config["text_encoder_kwargs"].get("tokenizer_subpath", "tokenizer")),
            local_files_only=True,
        )
        text_encoder = upstream.WanT5EncoderModel.from_pretrained(
            str(base / config["text_encoder_kwargs"].get("text_encoder_subpath", "text_encoder")),
            additional_kwargs=OmegaConf.to_container(config["text_encoder_kwargs"]),
            low_cpu_mem_usage=True,
            torch_dtype=torch.bfloat16,
        ).eval()
        clip = (
            upstream.CLIPModel.from_pretrained(
                str(
                    base
                    / config["image_encoder_kwargs"].get("image_encoder_subpath", "image_encoder")
                )
            )
            .to(torch.bfloat16)
            .eval()
        )
        config["scheduler_kwargs"]["shift"] = 1
        scheduler = upstream.FlowUniPCMultistepScheduler(
            **upstream.filter_kwargs(
                upstream.FlowUniPCMultistepScheduler,
                OmegaConf.to_container(config["scheduler_kwargs"]),
            )
        )
        pipeline = upstream.WanFunInpaintAudioPipeline(
            transformer=transformer,
            vae=vae,
            tokenizer=tokenizer,
            text_encoder=text_encoder,
            scheduler=scheduler,
            clip_image_encoder=clip,
        )
        state = torch.load(prepared, map_location=self.device, weights_only=True)
        # Install the prepared TorchAO tensor subclasses before moving the assembled pipeline. This
        # prevents simultaneous BF16 and FP8 transformer residency on the GPU during normal boot.
        missing, unexpected = pipeline.transformer.load_state_dict(state, strict=True, assign=True)
        if missing or unexpected:
            raise RuntimeError("ECHO_PREPARED_STATE_LOAD_MISMATCH")
        pipeline.to(device=self.device)
        coefficients = upstream.get_teacache_coefficients(str(base))
        if coefficients is not None:
            pipeline.transformer.enable_teacache(
                coefficients,
                8,
                0.1,
                num_skip_start_steps=5,
                offload=False,
            )
        self.pipeline = pipeline
        self.upstream = upstream
        return {
            "prepared_state_loaded": True,
            "source_flash_loaded_during_boot": False,
            "material_quantization_performed": False,
            "first_request_quantization": False,
        }

    def warm_up(self, scratch_root: Path) -> dict[str, object]:
        try:
            from PIL import Image
        except Exception as error:
            raise RuntimeError("ECHO_WARMUP_IMAGE_TOOL_UNAVAILABLE") from error
        image = scratch_root / "warmup.png"
        audio = scratch_root / "warmup.wav"
        output = scratch_root / "warmup-output.mp4"
        Image.new("RGB", (768, 768), (112, 116, 120)).save(image)
        with wave.open(str(audio), "wb") as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(16_000)
            samples = [
                int(1_200 * math.sin(2 * math.pi * 220 * index / 16_000))
                for index in range(16_000)
            ]
            stream.writeframes(struct.pack("<16000h", *samples))
        self.generate(
            source_path=image,
            audio_path=audio,
            prompt="A neutral presenter calibration frame.",
            frame_limit=5,
            output_path=output,
        )
        if not output.is_file() or output.stat().st_size < 1:
            raise RuntimeError("ECHO_REAL_WARMUP_OUTPUT_INVALID")
        return {"real_inference_path": True, "frames": 5, "output_bytes": output.stat().st_size}

    def generate(
        self,
        *,
        source_path: Path,
        audio_path: Path,
        prompt: str,
        frame_limit: int,
        output_path: Path,
    ) -> None:
        if self.pipeline is None or self.upstream is None or self.device is None:
            raise RuntimeError("ECHO_BACKEND_NOT_LOADED")
        import librosa
        import torch
        from moviepy import AudioFileClip, VideoFileClip
        from PIL import Image

        upstream = self.upstream
        ref_image = Image.open(source_path).convert("RGB")
        width, height = ref_image.size
        original_area = width * height
        ceiling_area = 768 * 768
        if ceiling_area < original_area:
            ratio = math.sqrt(original_area / ceiling_area)
            width = int(width / ratio // 16 * 16)
            height = int(height / ratio // 16 * 16)
        else:
            width = int(width // 16 * 16)
            height = int(height // 16 * 16)
        audio_clip = AudioFileClip(str(audio_path))
        video_length = min(int(audio_clip.duration * 25), frame_limit)
        ratio = self.pipeline.vae.config.temporal_compression_ratio
        video_length = ((video_length - 1) // ratio) * ratio + 1 if video_length != 1 else 1
        samples, sample_rate = librosa.load(str(audio_path), sr=16_000)
        samples = upstream.loudness_norm(samples, sample_rate)
        samples = samples[: int(video_length / 25 * sample_rate)]
        audio_feature = upstream.get_audio_embed(
            samples,
            self.wav2vec_feature_extractor,
            self.audio_encoder,
            video_length,
            sr=16_000,
            fps=25,
            device="cpu",
        )
        indices = torch.arange(5) - 2
        centers = torch.arange(0, video_length).unsqueeze(1) + indices.unsqueeze(0)
        centers = torch.clamp(centers, min=0, max=audio_feature.shape[0] - 1)
        audio_embeds = (
            audio_feature[centers].unsqueeze(0).to(device=self.device, dtype=torch.bfloat16)
        )
        video, mask, clip_image = upstream.get_image_to_video_latent2(
            ref_image,
            None,
            video_length=video_length,
            sample_size=[height, width],
        )
        generator = torch.Generator(device=self.device).manual_seed(43)
        with torch.no_grad():
            sample = self.pipeline(
                prompt.strip(),
                num_frames=video_length,
                negative_prompt="",
                audio_embeds=audio_embeds,
                audio_scale=1.0,
                ip_mask=None,
                use_un_ip_mask=False,
                height=height,
                width=width,
                generator=generator,
                neg_scale=1.0,
                neg_steps=0,
                use_dynamic_cfg=False,
                use_dynamic_acfg=False,
                guidance_scale=6.0,
                audio_guidance_scale=3.0,
                num_inference_steps=8,
                video=video,
                mask_video=mask,
                clip_image=clip_image,
                cfg_skip_ratio=0.0,
                shift=5.0,
            ).videos
        temporary = output_path.with_suffix(".video-only.mp4")
        upstream.save_videos_grid(sample[:, :, :video_length], str(temporary), fps=25)
        video_clip = VideoFileClip(str(temporary))
        clipped_audio = audio_clip.subclipped(0, video_length / 25)
        video_clip.with_audio(clipped_audio).write_videofile(
            str(output_path), codec="libx264", audio_codec="aac", threads=2, logger=None
        )
        video_clip.close()
        clipped_audio.close()
        audio_clip.close()
        temporary.unlink(missing_ok=True)
