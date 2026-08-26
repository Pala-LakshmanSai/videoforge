import json
from pathlib import Path

import pytest
from videoforge_contracts import validate_contract

from videoforge_image_media.jobs.render.filtergraph import (
    LoudnessMeasurement,
    compile_render_command,
)


SOURCE_SHA = "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83"
CANDIDATE_SHA = "sha256:f6c8dd219c07a26ab67fb13d8dbc103e110b4c045307f8c3e0c70aa3d805d442"
APPROVAL_SHA = "sha256:c3aae03da3f0134e12c2f432951189bd205dcbb7ab26a65d44061cec82984c45"


def manifest() -> dict[str, object]:
    return {
        "render_profile_version": "ffmpeg-render-v3",
        "total_frames": 600,
        "soulx_crop_profile_approval": {
            "profile_group_id": "soulx-pro-vf924u-full-split-v1",
            "candidate_sha256": CANDIDATE_SHA,
            "approval_sha256": APPROVAL_SHA,
            "avatar_source_sha256": SOURCE_SHA,
            "native_sample_sha256": "sha256:db70cd410062572052313278f12d67393aba213ca607fa3a3b9e3f6aad948bf1",
            "full_sample_sha256": "sha256:da31d87c2389769272733ff50a9114d4507a36aced1ebe48480c9ccf486de241",
            "split_sample_sha256": "sha256:f0b02351e38e2e8570e4e586b314da30813bb0a0eb09a567912bba9725b74993",
        },
        "segments": [
            {
                "start_frame": 0,
                "end_frame_exclusive": 300,
                "timeline_composition": "AVATAR_FULL",
                "accepted_assets": {
                    "avatar": {"asset_id": "avatar-full", "sha256": "sha256:" + "4" * 64},
                    "source_background": {
                        "asset_id": "approved-source",
                        "sha256": SOURCE_SHA,
                    },
                },
                "render": {
                    "avatar_source_profile": "soulx-pro-vf924u-approved-v1",
                    "crop_profile_id": "soulx-pro-ranga-full-source-composite-v1",
                    "crop_profile_evidence_sha256": CANDIDATE_SHA,
                    "crop_profile_acceptance_sha256": APPROVAL_SHA,
                    "source_background_transform": "scale=1920:1080:flags=lanczos,fps=30",
                    "native_foreground_transform": "scale=1080:1080:flags=lanczos,fps=30,format=rgba",
                    "native_foreground_overlay": {"x": 420, "y": 0},
                    "horizontal_alpha_feather_pixels_each_edge": 32,
                },
            },
            {
                "start_frame": 300,
                "end_frame_exclusive": 600,
                "timeline_composition": "AVATAR_SPLIT_IMAGE",
                "accepted_assets": {
                    "avatar": {"asset_id": "avatar-split", "sha256": "sha256:" + "5" * 64},
                    "right_image": {"asset_id": "context", "sha256": "sha256:" + "6" * 64},
                },
                "render": {
                    "avatar_source_profile": "soulx-pro-vf924u-approved-v1",
                    "crop_profile_id": "soulx-pro-ranga-split-composite-v1",
                    "crop_profile_evidence_sha256": CANDIDATE_SHA,
                    "crop_profile_acceptance_sha256": APPROVAL_SHA,
                    "context_transform": "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=960:1080,zoompan=z=min(zoom+0.000133333,1.04):d=300:s=960x1080:fps=30",
                    "avatar_crop": "448:504:32:4",
                    "right_image_zoom_profile": "split-right-zoom-v3",
                },
            },
        ],
    }


def compile_graph(value: dict[str, object]) -> str:
    asset_ids = {
        asset["asset_id"]
        for segment in value["segments"]  # type: ignore[index]
        for asset in segment["accepted_assets"].values()
    }
    paths = {asset_id: Path("/safe") / f"{asset_id}.bin" for asset_id in asset_ids}
    return compile_render_command(
        ffmpeg=Path("/trusted/ffmpeg"),
        manifest=value,
        asset_paths=paths,
        voiceover_path=Path("/safe/voice.wav"),
        output_path=Path("/safe/output.mp4"),
        input_loudness=LoudnessMeasurement(-16.0, -2.0, 2.0, -31.0, 0.0),
    ).filtergraph


def test_compiles_exact_approved_soulx_full_and_split_filtergraphs() -> None:
    graph = compile_graph(manifest())

    assert "scale=1920:1080:flags=lanczos,fps=30" in graph
    assert "scale=1080:1080:flags=lanczos,fps=30,format=rgba" in graph
    assert "geq=lum='if(lt(X,32),255*X/32,if(gt(X,W-33),255*(W-1-X)/32,255))'" in graph
    assert "alphamerge" in graph
    assert "overlay=420:0:shortest=1" in graph
    assert "crop=448:504:32:4,scale=960:1080:flags=lanczos,fps=30" in graph
    assert (
        "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=960:1080" in graph
    )
    assert "zoompan=z='min(zoom+0.000133333\\,1.04)':d=300:s=960x1080:fps=30" in graph
    assert "hstack=inputs=2" in graph
    assert not any(token in graph for token in ("drawtext", "subtitles", "xfade"))


def test_canonical_150_frame_split_and_arbitrary_short_split_keep_exact_d_300() -> None:
    canonical = validate_contract(
        "resolvedRenderManifest",
        json.loads(
            Path(
                "project-context/evidence/fixtures/resolved_render_manifest.soulx-approved.valid.json"
            ).read_text()
        ),
    )
    canonical_graph = compile_graph(canonical)
    assert "zoompan=z='min(zoom+0.000133333\\,1.04)':d=300:s=960x1080:fps=30" in canonical_graph

    short = manifest()
    short["segments"][1]["end_frame_exclusive"] = 330  # type: ignore[index]
    short["total_frames"] = 330
    short_graph = compile_graph(short)
    assert "zoompan=z='min(zoom+0.000133333\\,1.04)':d=300:s=960x1080:fps=30" in short_graph
    assert "d=30:s=960x1080" not in short_graph


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("soulx_crop_profile_approval", "approval_sha256"), "sha256:" + "0" * 64),
        (("segments", 0, "accepted_assets", "source_background", "sha256"), "sha256:" + "1" * 64),
        (("segments", 0, "render", "horizontal_alpha_feather_pixels_each_edge"), 31),
        (("segments", 1, "render", "avatar_crop"), "448:504:31:4"),
        (("segments", 1, "render", "context_transform"), "drifted"),
    ],
)
def test_rejects_soulx_approval_media_or_geometry_drift(
    path: tuple[object, ...], value: object
) -> None:
    candidate = manifest()
    target: object = candidate
    for key in path[:-1]:
        target = target[key]  # type: ignore[index]
    target[path[-1]] = value  # type: ignore[index]

    with pytest.raises(ValueError, match="SoulX"):
        compile_graph(candidate)
