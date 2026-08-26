from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast


@dataclass(frozen=True)
class LoudnessMeasurement:
    integrated_lufs: float
    true_peak_dbtp: float
    loudness_range_lu: float
    threshold_lufs: float
    target_offset_db: float

    @property
    def requires_normalization(self) -> bool:
        return not (-17.0 <= self.integrated_lufs <= -15.0 and self.true_peak_dbtp <= -1.5)


@dataclass(frozen=True)
class RenderCommandPlan:
    arguments: tuple[str, ...]
    filtergraph: str
    normalized: bool


LEGACY_RENDER_PROFILE_VERSION = "ffmpeg-render-v1"
SUBTLE_RENDER_PROFILE_VERSION = "ffmpeg-render-v2"
SMOOTH_RENDER_PROFILE_VERSION = "ffmpeg-render-v3"

SOULX_SOURCE_PROFILE = "soulx-pro-vf924u-approved-v1"
SOULX_PROFILE_GROUP = "soulx-pro-vf924u-full-split-v1"
SOULX_CANDIDATE_SHA256 = "sha256:f6c8dd219c07a26ab67fb13d8dbc103e110b4c045307f8c3e0c70aa3d805d442"
SOULX_APPROVAL_SHA256 = "sha256:c3aae03da3f0134e12c2f432951189bd205dcbb7ab26a65d44061cec82984c45"
SOULX_SOURCE_SHA256 = "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83"
SOULX_NATIVE_SAMPLE_SHA256 = (
    "sha256:db70cd410062572052313278f12d67393aba213ca607fa3a3b9e3f6aad948bf1"
)
SOULX_FULL_SAMPLE_SHA256 = "sha256:da31d87c2389769272733ff50a9114d4507a36aced1ebe48480c9ccf486de241"
SOULX_SPLIT_SAMPLE_SHA256 = (
    "sha256:f0b02351e38e2e8570e4e586b314da30813bb0a0eb09a567912bba9725b74993"
)

_ZOOM_PRECISION_FACTOR = 4


def _zoom_expression(frame_count: int, delta: float, *, quintic: bool) -> str:
    denominator = max(frame_count - 1, 1)
    progress = f"(on/{denominator})"
    if quintic:
        easing = f"({progress}*{progress}*{progress}*({progress}*(6*{progress}-15)+10))"
    else:
        easing = f"(3*{progress}*{progress}-2*{progress}*{progress}*{progress})"
    return f"1+{delta:.6f}*{easing}"


def _zoompan_image_filter(
    input_index: int,
    width: int,
    frame_count: int,
    delta: float,
    *,
    high_precision: bool,
) -> str:
    zoom = _zoom_expression(frame_count, delta, quintic=high_precision)
    if high_precision:
        source_width = width * _ZOOM_PRECISION_FACTOR
        source_height = 1080 * _ZOOM_PRECISION_FACTOR
        source_geometry = (
            f"scale={source_width}:{source_height}:"
            "force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={source_width}:{source_height},setsar=1,"
        )
    else:
        source_geometry = (
            f"scale={width}:1080:force_original_aspect_ratio=increase,crop={width}:1080,setsar=1,"
        )
    return (
        f"[{input_index}:v:0]"
        f"{source_geometry}"
        f"zoompan=z='{zoom}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':"
        f"d={frame_count}:s={width}x1080:fps=30,"
        f"trim=end_frame={frame_count},setpts=PTS-STARTPTS"
    )


def _continuous_image_filter(
    input_index: int,
    width: int,
    frame_count: int,
    delta: float,
) -> str:
    zoom = _zoom_expression(frame_count, delta, quintic=True)
    x_margin = f"(W-W/({zoom}))/2"
    y_margin = f"(H-H/({zoom}))/2"
    return (
        f"[{input_index}:v:0]"
        f"scale={width}:1080:force_original_aspect_ratio=increase:flags=lanczos,"
        f"crop={width}:1080,setsar=1,"
        f"perspective=x0='{x_margin}':y0='{y_margin}':"
        f"x1='W-({x_margin})':y1='{y_margin}':"
        f"x2='{x_margin}':y2='H-({y_margin})':"
        f"x3='W-({x_margin})':y3='H-({y_margin})':"
        "interpolation=cubic:sense=source:eval=frame,"
        f"fps=30,trim=end_frame={frame_count},setpts=PTS-STARTPTS"
    )


def _image_filter(
    input_index: int,
    width: int,
    frame_count: int,
    delta: float,
    *,
    profile_version: str,
) -> str:
    if profile_version == SMOOTH_RENDER_PROFILE_VERSION:
        return _continuous_image_filter(input_index, width, frame_count, delta)
    return _zoompan_image_filter(
        input_index,
        width,
        frame_count,
        delta,
        high_precision=profile_version == SUBTLE_RENDER_PROFILE_VERSION,
    )


def _zoom_delta(*, frame_count: int, split: bool, profile_version: str) -> float:
    if profile_version == SMOOTH_RENDER_PROFILE_VERSION:
        if split or frame_count <= 120:
            return 0.025
        if frame_count <= 210:
            return 0.03
        return 0.035
    if profile_version == SUBTLE_RENDER_PROFILE_VERSION:
        if split or frame_count <= 120:
            return 0.015
        if frame_count <= 210:
            return 0.02
        return 0.025
    if profile_version == LEGACY_RENDER_PROFILE_VERSION:
        if split:
            return 0.04
        return 0.04 if frame_count <= 120 else 0.06 if frame_count <= 210 else 0.08
    raise ValueError(f"Unsupported render profile {profile_version}")


def _audio_filter(measurement: LoudnessMeasurement) -> str:
    if not measurement.requires_normalization:
        return "aresample=48000"
    return (
        "loudnorm=I=-16:TP=-1.5:LRA=11:"
        f"measured_I={measurement.integrated_lufs:.3f}:"
        f"measured_TP={measurement.true_peak_dbtp:.3f}:"
        f"measured_LRA={measurement.loudness_range_lu:.3f}:"
        f"measured_thresh={measurement.threshold_lufs:.3f}:"
        f"offset={measurement.target_offset_db:.3f}:"
        "linear=true:print_format=summary,aresample=48000"
    )


def _validate_soulx_approval(manifest: Mapping[str, Any]) -> None:
    segments = cast(list[dict[str, Any]], manifest["segments"])
    soulx = [
        segment
        for segment in segments
        if segment["timeline_composition"] != "IMAGE_FULL"
        and segment["render"]["avatar_source_profile"] == SOULX_SOURCE_PROFILE
    ]
    if not soulx:
        if "soulx_crop_profile_approval" in manifest:
            raise ValueError("SoulX approval cannot accompany a non-SoulX render")
        return
    approval = cast(dict[str, str], manifest.get("soulx_crop_profile_approval"))
    expected = {
        "profile_group_id": SOULX_PROFILE_GROUP,
        "candidate_sha256": SOULX_CANDIDATE_SHA256,
        "approval_sha256": SOULX_APPROVAL_SHA256,
        "avatar_source_sha256": SOULX_SOURCE_SHA256,
        "native_sample_sha256": SOULX_NATIVE_SAMPLE_SHA256,
        "full_sample_sha256": SOULX_FULL_SAMPLE_SHA256,
        "split_sample_sha256": SOULX_SPLIT_SAMPLE_SHA256,
    }
    if approval != expected:
        raise ValueError("SoulX approval evidence is absent or drifted")
    for segment in soulx:
        composition = segment["timeline_composition"]
        accepted = segment["accepted_assets"]
        render = segment["render"]
        if (
            render.get("crop_profile_evidence_sha256") != SOULX_CANDIDATE_SHA256
            or render.get("crop_profile_acceptance_sha256") != SOULX_APPROVAL_SHA256
        ):
            raise ValueError("SoulX segment evidence is drifted")
        if composition == "AVATAR_FULL":
            if (
                accepted.get("source_background", {}).get("sha256") != SOULX_SOURCE_SHA256
                or render.get("crop_profile_id") != "soulx-pro-ranga-full-source-composite-v1"
                or render.get("source_background_transform")
                != "scale=1920:1080:flags=lanczos,fps=30"
                or render.get("native_foreground_transform")
                != "scale=1080:1080:flags=lanczos,fps=30,format=rgba"
                or render.get("native_foreground_overlay") != {"x": 420, "y": 0}
                or render.get("horizontal_alpha_feather_pixels_each_edge") != 32
            ):
                raise ValueError("SoulX full profile is absent or drifted")
        elif composition == "AVATAR_SPLIT_IMAGE":
            if (
                render.get("crop_profile_id") != "soulx-pro-ranga-split-composite-v1"
                or render.get("avatar_crop") != "448:504:32:4"
                or render.get("context_transform")
                != "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,"
                "crop=960:1080,zoompan=z=min(zoom+0.000133333,1.04):"
                "d=300:s=960x1080:fps=30"
                or render.get("right_image_zoom_profile") != "split-right-zoom-v3"
            ):
                raise ValueError("SoulX split profile is absent or drifted")
        else:
            raise ValueError("SoulX profile cannot be used by this composition")


def compile_render_command(
    *,
    ffmpeg: Path,
    manifest: Mapping[str, Any],
    asset_paths: Mapping[str, Path],
    voiceover_path: Path,
    output_path: Path,
    input_loudness: LoudnessMeasurement,
) -> RenderCommandPlan:
    """Compile one direct FFmpeg argument array; no command shell is involved."""

    _validate_soulx_approval(manifest)

    total_frames = cast(int, manifest["total_frames"])
    if total_frames <= 0:
        raise ValueError("total_frames must be positive")
    segments = cast(list[dict[str, Any]], manifest["segments"])
    if not segments:
        raise ValueError("at least one render segment is required")
    profile_version = cast(str, manifest["render_profile_version"])
    arguments: list[str] = [str(ffmpeg), "-hide_banner", "-nostdin", "-n"]
    graph: list[str] = []
    input_index = 0
    video_labels: list[str] = []

    def add_input(asset_id: str, *, still: bool) -> int:
        nonlocal input_index
        path = asset_paths.get(asset_id)
        if path is None:
            raise ValueError(f"No safe path for accepted asset {asset_id}")
        if still:
            arguments.extend(["-loop", "1", "-framerate", "30"])
        arguments.extend(["-i", str(path)])
        assigned = input_index
        input_index += 1
        return assigned

    for segment_index, segment in enumerate(segments):
        frame_count = cast(int, segment["end_frame_exclusive"]) - cast(int, segment["start_frame"])
        if frame_count <= 0:
            raise ValueError("render segments must have positive frame duration")
        label = f"v{segment_index}"
        video_labels.append(f"[{label}]")
        composition = cast(str, segment["timeline_composition"])
        accepted = cast(dict[str, dict[str, str]], segment["accepted_assets"])
        render = cast(dict[str, str], segment["render"])

        if composition == "AVATAR_FULL":
            if render["avatar_source_profile"] == SOULX_SOURCE_PROFILE:
                background_index = add_input(accepted["source_background"]["asset_id"], still=True)
                avatar_index = add_input(accepted["avatar"]["asset_id"], still=False)
                background_label = f"background{segment_index}"
                foreground_label = f"foreground{segment_index}"
                mask_label = f"mask{segment_index}"
                feathered_label = f"feathered{segment_index}"
                duration_seconds = frame_count / 30
                graph.append(
                    f"[{background_index}:v:0]scale=1920:1080:flags=lanczos,fps=30,"
                    f"trim=end_frame={frame_count},setpts=PTS-STARTPTS[{background_label}]"
                )
                graph.append(
                    f"[{avatar_index}:v:0]scale=1080:1080:flags=lanczos,fps=30,"
                    f"format=rgba,trim=end_frame={frame_count},"
                    f"setpts=PTS-STARTPTS[{foreground_label}]"
                )
                graph.append(
                    f"color=white:s=1080x1080:r=30:d={duration_seconds:.6f},format=gray,"
                    "geq=lum='if(lt(X,32),255*X/32,"
                    f"if(gt(X,W-33),255*(W-1-X)/32,255))'[{mask_label}]"
                )
                graph.append(f"[{foreground_label}][{mask_label}]alphamerge[{feathered_label}]")
                graph.append(
                    f"[{background_label}][{feathered_label}]overlay=420:0:shortest=1,"
                    f"trim=end_frame={frame_count},setpts=PTS-STARTPTS[{label}]"
                )
            else:
                avatar_index = add_input(accepted["avatar"]["asset_id"], still=False)
                graph.append(
                    f"[{avatar_index}:v:0]crop={render['avatar_crop']},"
                    f"scale=1920:1080,setsar=1,fps=30:round=near,"
                    f"trim=end_frame={frame_count},setpts=PTS-STARTPTS[{label}]"
                )
        elif composition == "IMAGE_FULL":
            image_index = add_input(accepted["image"]["asset_id"], still=True)
            delta = _zoom_delta(
                frame_count=frame_count,
                split=False,
                profile_version=profile_version,
            )
            graph.append(
                f"{_image_filter(image_index, 1920, frame_count, delta, profile_version=profile_version)}[{label}]"
            )
        elif composition == "AVATAR_SPLIT_IMAGE":
            avatar_index = add_input(accepted["avatar"]["asset_id"], still=False)
            image_index = add_input(accepted["right_image"]["asset_id"], still=True)
            avatar_label = f"avatar{segment_index}"
            image_label = f"image{segment_index}"
            if render["avatar_source_profile"] == SOULX_SOURCE_PROFILE:
                graph.append(
                    f"[{avatar_index}:v:0]crop=448:504:32:4,"
                    "scale=960:1080:flags=lanczos,fps=30,"
                    f"trim=end_frame={frame_count},setpts=PTS-STARTPTS[{avatar_label}]"
                )
                graph.append(
                    f"[{image_index}:v:0]scale=1920:1080:"
                    "force_original_aspect_ratio=increase:flags=lanczos,crop=960:1080,"
                    "zoompan=z='min(zoom+0.000133333\\,1.04)':"
                    "d=300:s=960x1080:fps=30,"
                    f"trim=end_frame={frame_count},setpts=PTS-STARTPTS[{image_label}]"
                )
            else:
                graph.append(
                    f"[{avatar_index}:v:0]crop={render['avatar_crop']},"
                    "scale=960:1080,setsar=1,fps=30:round=near,"
                    f"trim=end_frame={frame_count},setpts=PTS-STARTPTS[{avatar_label}]"
                )
                delta = _zoom_delta(
                    frame_count=frame_count,
                    split=True,
                    profile_version=profile_version,
                )
                graph.append(
                    f"{_image_filter(image_index, 960, frame_count, delta, profile_version=profile_version)}[{image_label}]"
                )
            graph.append(
                f"[{avatar_label}][{image_label}]hstack=inputs=2,"
                f"trim=end_frame={frame_count},setpts=PTS-STARTPTS[{label}]"
            )
        else:
            raise ValueError(f"Unsupported timeline composition {composition}")

    arguments.extend(["-i", str(voiceover_path)])
    audio_index = input_index
    graph.append(
        f"{''.join(video_labels)}concat=n={len(video_labels)}:v=1:a=0,format=yuv420p[vout]"
    )
    duration_seconds = total_frames / 30
    graph.append(
        f"[{audio_index}:a:0]atrim=end={duration_seconds:.6f},asetpts=PTS-STARTPTS,"
        f"{_audio_filter(input_loudness)}[aout]"
    )
    filtergraph = ";".join(graph)
    arguments.extend(
        [
            "-filter_complex",
            filtergraph,
            "-map",
            "[vout]",
            "-map",
            "[aout]",
            "-frames:v",
            str(total_frames),
            "-fps_mode",
            "cfr",
            "-r",
            "30",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-sn",
            "-dn",
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    )
    return RenderCommandPlan(
        arguments=tuple(arguments),
        filtergraph=filtergraph,
        normalized=input_loudness.requires_normalization,
    )
