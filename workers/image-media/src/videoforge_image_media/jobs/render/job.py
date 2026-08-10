from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from videoforge_contracts import ContractValidationError, validate_contract

from .filtergraph import (
    LEGACY_RENDER_PROFILE_VERSION,
    SMOOTH_RENDER_PROFILE_VERSION,
    SUBTLE_RENDER_PROFILE_VERSION,
    LoudnessMeasurement,
    RenderCommandPlan,
    compile_render_command,
)
from .ports import (
    ArtifactIO,
    ArtifactResolver,
    CancellationProbe,
    ProcessResult,
    ProcessRunner,
    RenderTools,
    ToolResolver,
)
from .probe import ProbeValidationError, ProbeFacts, parse_ffprobe_facts, parse_loudness_measurement

ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
OBJECT_URI_PATTERN = re.compile(
    r"^vf-local://objects/sha256/(?P<prefix>[0-9a-f]{2})/"
    r"(?P<digest>[0-9a-f]{64})\.(?P<extension>[a-z0-9]{1,10})$"
)
SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE_CODECS = frozenset({"bmp", "gif", "mjpeg", "png", "tiff", "webp"})
AVATAR_SOURCE_PROFILES = {
    "avatarforcing-centered-832x480p25-v1": (832, 480, 25, 1),
    "skyreels-centered-1280x720p24-v1": (1280, 720, 24, 1),
}


@dataclass(frozen=True)
class RenderJobDependencies:
    resolver: ArtifactResolver
    artifacts: ArtifactIO
    tools: ToolResolver
    process: ProcessRunner
    cancellation: CancellationProbe


@dataclass(frozen=True)
class ExpectedAsset:
    asset_id: str
    sha256: str
    kind: str
    renderer_source_profile: str | None = None


class _RenderFailure(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class _RenderCancelled(Exception):
    pass


def _validated_result(result: dict[str, Any]) -> dict[str, Any]:
    return cast(dict[str, Any], validate_contract("renderJobResult", result))


def _failure_result(
    attempt_id: str,
    code: str,
    message: str,
    *,
    retryable: bool,
) -> dict[str, Any]:
    return _validated_result(
        {
            "schema_version": "render-job-result/v1",
            "attempt_id": attempt_id,
            "status": "FAILED",
            "output": None,
            "probe": None,
            "error": {"code": code, "message": message, "retryable": retryable},
        }
    )


def _cancelled_result(attempt_id: str) -> dict[str, Any]:
    return _validated_result(
        {
            "schema_version": "render-job-result/v1",
            "attempt_id": attempt_id,
            "status": "CANCELLED",
            "output": None,
            "probe": None,
            "error": {
                "code": "RENDER_CANCELLED",
                "message": "Render cancelled before publication.",
                "retryable": False,
            },
        }
    )


def _parse_json_document(data: bytes) -> dict[str, Any]:
    def reject_constant(value: str) -> None:
        raise ValueError(f"Non-finite JSON constant {value}")

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON property {key}")
            result[key] = value
        return result

    parsed = json.loads(
        data.decode("utf-8"),
        object_pairs_hook=reject_duplicates,
        parse_constant=reject_constant,
    )
    if not isinstance(parsed, dict):
        raise ValueError("Manifest must be a JSON object")
    return parsed


def _object_uri_digest(uri: str, expected_sha256: str) -> str:
    match = OBJECT_URI_PATTERN.fullmatch(uri)
    if match is None or not SHA256_PATTERN.fullmatch(expected_sha256):
        raise _RenderFailure(
            "RENDER_PATH_REJECTED",
            "Artifact URI is outside the content-addressed local namespace.",
            retryable=False,
        )
    digest = match.group("digest")
    if match.group("prefix") != digest[:2] or expected_sha256 != f"sha256:{digest}":
        raise _RenderFailure(
            "RENDER_ASSET_HASH_MISMATCH",
            "Artifact URI digest does not match its declared checksum.",
            retryable=False,
        )
    return match.group("extension")


def _expected_object_uri(sha256: str, extension: str) -> str:
    digest = sha256.removeprefix("sha256:")
    return f"vf-local://objects/sha256/{digest[:2]}/{digest}.{extension}"


def _expected_assets(manifest: Mapping[str, Any]) -> dict[str, ExpectedAsset]:
    voiceover = cast(dict[str, str], manifest["voiceover"])
    expected = {
        voiceover["asset_id"]: ExpectedAsset(
            asset_id=voiceover["asset_id"],
            sha256=voiceover["sha256"],
            kind="VOICEOVER",
        )
    }
    kinds_by_sha256 = {voiceover["sha256"]: "VOICEOVER"}
    avatar_profiles_by_sha256: dict[str, str] = {}
    for segment in cast(list[dict[str, Any]], manifest["segments"]):
        composition = cast(str, segment["timeline_composition"])
        accepted = cast(dict[str, dict[str, str]], segment["accepted_assets"])
        render = cast(dict[str, str], segment["render"])
        bindings: Sequence[tuple[dict[str, str], str]]
        if composition == "AVATAR_FULL":
            bindings = ((accepted["avatar"], "AVATAR_CLIP"),)
        elif composition == "IMAGE_FULL":
            bindings = ((accepted["image"], "IMAGE"),)
        else:
            bindings = (
                (accepted["avatar"], "AVATAR_CLIP"),
                (accepted["right_image"], "IMAGE"),
            )
        for binding, kind in bindings:
            candidate = ExpectedAsset(
                asset_id=binding["asset_id"],
                sha256=binding["sha256"],
                kind=kind,
                renderer_source_profile=(
                    render["avatar_source_profile"] if kind == "AVATAR_CLIP" else None
                ),
            )
            previous = expected.get(candidate.asset_id)
            if previous is not None and previous != candidate:
                if (
                    previous.sha256 == candidate.sha256
                    and previous.kind == candidate.kind
                    and previous.renderer_source_profile != candidate.renderer_source_profile
                ):
                    raise _RenderFailure(
                        "RENDER_INPUT_INVALID",
                        "Resolved manifest assigns conflicting source profiles to one avatar.",
                        retryable=False,
                    )
                raise _RenderFailure(
                    "RENDER_ASSET_HASH_MISMATCH",
                    "Resolved manifest reuses an asset identity with conflicting facts.",
                    retryable=False,
                )
            if candidate.renderer_source_profile is not None:
                prior_profile = avatar_profiles_by_sha256.get(candidate.sha256)
                if prior_profile is not None and prior_profile != candidate.renderer_source_profile:
                    raise _RenderFailure(
                        "RENDER_INPUT_INVALID",
                        "Resolved manifest assigns conflicting source profiles to reused avatar bytes.",
                        retryable=False,
                    )
                avatar_profiles_by_sha256[candidate.sha256] = candidate.renderer_source_profile
            prior_kind = kinds_by_sha256.get(candidate.sha256)
            if prior_kind is not None and prior_kind != candidate.kind:
                raise _RenderFailure(
                    "RENDER_ASSET_HASH_MISMATCH",
                    "Resolved manifest reuses one checksum for incompatible media kinds.",
                    retryable=False,
                )
            expected[candidate.asset_id] = candidate
            kinds_by_sha256[candidate.sha256] = candidate.kind
    return expected


def _probe_frame_rate(stream: Mapping[str, Any]) -> tuple[int, int]:
    for field in ("avg_frame_rate", "r_frame_rate"):
        value = stream.get(field)
        if not isinstance(value, str):
            continue
        parts = value.split("/", maxsplit=1)
        if len(parts) != 2:
            continue
        try:
            numerator, denominator = (int(part) for part in parts)
        except ValueError:
            continue
        if numerator > 0 and denominator > 0:
            return numerator, denominator
    raise ValueError("Visual input has no positive frame rate")


class RenderJob:
    def __init__(self, dependencies: RenderJobDependencies) -> None:
        self._dependencies = dependencies

    def run(self, input_document: object, *, claimed_attempt_id: str) -> dict[str, Any]:
        if ID_PATTERN.fullmatch(claimed_attempt_id) is None:
            raise ValueError("claimed_attempt_id must be a canonical contract ID")
        try:
            document = cast(dict[str, Any], validate_contract("renderJobInput", input_document))
        except ContractValidationError:
            return _failure_result(
                claimed_attempt_id,
                "RENDER_INPUT_INVALID",
                "Render input failed canonical contract validation.",
                retryable=False,
            )
        if document["attempt_id"] != claimed_attempt_id:
            return _failure_result(
                claimed_attempt_id,
                "RENDER_INPUT_INVALID",
                "Render input attempt does not match the claimed attempt.",
                retryable=False,
            )

        try:
            return self._run_validated(document)
        except _RenderCancelled:
            return _cancelled_result(claimed_attempt_id)
        except _RenderFailure as failure:
            return _failure_result(
                claimed_attempt_id,
                failure.code,
                failure.message,
                retryable=failure.retryable,
            )

    def _check_cancelled(self, token: str) -> None:
        if self._dependencies.cancellation.is_cancelled(token):
            raise _RenderCancelled

    def _safe_object_path(self, uri: str) -> Path:
        try:
            path = self._dependencies.resolver.resolve_object(uri)
        except (KeyError, OSError, ValueError) as error:
            raise _RenderFailure(
                "RENDER_PATH_REJECTED",
                "Local object path resolution was rejected.",
                retryable=False,
            ) from error
        if not path.is_absolute():
            raise _RenderFailure(
                "RENDER_PATH_REJECTED",
                "Artifact resolver returned a non-absolute object path.",
                retryable=False,
            )
        return path

    def _safe_run_path(self, uri: str) -> Path:
        try:
            path = self._dependencies.resolver.resolve_run(uri)
        except (KeyError, OSError, ValueError) as error:
            raise _RenderFailure(
                "RENDER_PATH_REJECTED",
                "Local run path resolution was rejected.",
                retryable=False,
            ) from error
        if not path.is_absolute():
            raise _RenderFailure(
                "RENDER_PATH_REJECTED",
                "Artifact resolver returned a non-absolute run path.",
                retryable=False,
            )
        return path

    def _require_file(
        self,
        path: Path,
        *,
        missing_code: str = "RENDER_ASSET_MISSING",
        missing_message: str = "Required render input is unavailable.",
    ) -> None:
        try:
            exists = self._dependencies.artifacts.exists(path)
        except OSError as error:
            raise _RenderFailure(
                missing_code,
                missing_message,
                retryable=False,
            ) from error
        if not exists:
            raise _RenderFailure(
                missing_code,
                missing_message,
                retryable=False,
            )

    def _run_process(
        self,
        arguments: Sequence[str],
        *,
        token: str,
        failure_code: str,
    ) -> ProcessResult:
        result = self._dependencies.process.run(
            arguments,
            should_cancel=lambda: self._dependencies.cancellation.is_cancelled(token),
        )
        if result.cancelled:
            raise _RenderCancelled
        if result.launch_error == "missing":
            raise _RenderFailure(
                "RENDER_TOOL_MISSING",
                "A pinned local media tool is unavailable.",
                retryable=True,
            )
        if result.launch_error is not None or result.return_code != 0:
            raise _RenderFailure(
                failure_code,
                "A local media process failed without publishing output.",
                retryable=True,
            )
        self._check_cancelled(token)
        return result

    def _measure_loudness(
        self,
        tools: RenderTools,
        path: Path,
        token: str,
    ) -> LoudnessMeasurement:
        result = self._run_process(
            (
                str(tools.ffmpeg),
                "-hide_banner",
                "-nostdin",
                "-v",
                "info",
                "-i",
                str(path),
                "-map",
                "0:a:0",
                "-af",
                "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
                "-f",
                "null",
                "-",
            ),
            token=token,
            failure_code="RENDER_PROBE_FAILED",
        )
        try:
            measurement = parse_loudness_measurement(f"{result.stdout}\n{result.stderr}")
        except ProbeValidationError as error:
            raise _RenderFailure(
                "RENDER_PROBE_FAILED",
                "Loudness measurement was incomplete or invalid.",
                retryable=False,
            ) from error
        if not (
            -100.0 <= measurement.integrated_lufs <= 0.0
            and -100.0 <= measurement.true_peak_dbtp <= 20.0
        ):
            raise _RenderFailure(
                "RENDER_PROBE_FAILED",
                "Loudness measurement is outside the canonical probe range.",
                retryable=False,
            )
        return measurement

    def _resolve_tools(self, document: Mapping[str, Any]) -> RenderTools:
        try:
            tools = self._dependencies.tools.resolve()
        except (FileNotFoundError, OSError, ValueError) as error:
            raise _RenderFailure(
                "RENDER_TOOL_MISSING",
                "Pinned FFmpeg tools are unavailable.",
                retryable=True,
            ) from error
        expected = cast(dict[str, str], document["tools"])
        if (
            not tools.ffmpeg.is_absolute()
            or not tools.ffprobe.is_absolute()
            or tools.ffmpeg_version != expected["ffmpeg_version"]
            or tools.ffprobe_version != expected["ffprobe_version"]
        ):
            raise _RenderFailure(
                "RENDER_TOOL_MISSING",
                "Resolved media tools do not match the pinned input versions.",
                retryable=False,
            )
        return tools

    def _load_manifest(self, document: Mapping[str, Any]) -> dict[str, Any]:
        pointer = cast(dict[str, str], document["resolved_render_manifest"])
        extension = _object_uri_digest(pointer["artifact_uri"], pointer["sha256"])
        if extension != "json":
            raise _RenderFailure(
                "RENDER_PATH_REJECTED",
                "Resolved render manifest must be a JSON object artifact.",
                retryable=False,
            )
        path = self._safe_object_path(pointer["artifact_uri"])
        self._require_file(
            path,
            missing_code="RENDER_MANIFEST_HASH_MISMATCH",
            missing_message="Resolved render manifest is unavailable.",
        )
        try:
            raw_bytes = self._dependencies.artifacts.read_bytes(path)
        except OSError as error:
            raise _RenderFailure(
                "RENDER_MANIFEST_HASH_MISMATCH",
                "Resolved render manifest could not be verified.",
                retryable=False,
            ) from error
        actual_sha256 = "sha256:" + hashlib.sha256(raw_bytes).hexdigest()
        if actual_sha256 != pointer["sha256"]:
            raise _RenderFailure(
                "RENDER_MANIFEST_HASH_MISMATCH",
                "Resolved render manifest exact-byte hash does not match its pointer.",
                retryable=False,
            )
        try:
            manifest = _parse_json_document(raw_bytes)
            validate_contract("resolvedRenderManifest", manifest)
        except (UnicodeDecodeError, ValueError, ContractValidationError) as error:
            raise _RenderFailure(
                "RENDER_INPUT_INVALID",
                "Resolved render manifest failed canonical contract validation.",
                retryable=False,
            ) from error
        if manifest["project_revision_id"] != document["project_revision_id"]:
            raise _RenderFailure(
                "RENDER_INPUT_INVALID",
                "Resolved render manifest belongs to another project revision.",
                retryable=False,
            )
        render_profile_version = manifest["render_profile_version"]
        if render_profile_version not in {
            LEGACY_RENDER_PROFILE_VERSION,
            SUBTLE_RENDER_PROFILE_VERSION,
            SMOOTH_RENDER_PROFILE_VERSION,
        }:
            raise _RenderFailure(
                "RENDER_INPUT_INVALID",
                "Resolved render manifest uses an unsupported render profile.",
                retryable=False,
            )
        zoom_suffix = render_profile_version.rsplit("-", maxsplit=1)[-1]
        for segment in cast(list[dict[str, Any]], manifest["segments"]):
            composition = segment["timeline_composition"]
            render = cast(dict[str, str], segment["render"])
            if (
                composition == "IMAGE_FULL"
                and render["zoom_profile"] != f"image-full-zoom-{zoom_suffix}"
            ) or (
                composition == "AVATAR_SPLIT_IMAGE"
                and render["right_image_zoom_profile"] != f"split-right-zoom-{zoom_suffix}"
            ):
                raise _RenderFailure(
                    "RENDER_INPUT_INVALID",
                    "Resolved render manifest mixes incompatible render and zoom profiles.",
                    retryable=False,
                )
        total_frames = cast(int, manifest["total_frames"])
        if not 300 <= total_frames <= 108_000:
            raise _RenderFailure(
                "RENDER_INPUT_INVALID",
                "The fixed local render profile supports 10-second to 1-hour timelines.",
                retryable=False,
            )
        return manifest

    def _resolve_assets(
        self,
        document: Mapping[str, Any],
        manifest: Mapping[str, Any],
    ) -> tuple[dict[str, Path], Path]:
        expected = _expected_assets(manifest)
        supplied: dict[str, dict[str, str]] = {}
        paths: dict[str, Path] = {}
        for raw_asset in cast(list[dict[str, str]], document["assets"]):
            asset_id = raw_asset["asset_id"]
            if asset_id in supplied:
                raise _RenderFailure(
                    "RENDER_INPUT_INVALID",
                    "Render input contains duplicate asset identities.",
                    retryable=False,
                )
            supplied[asset_id] = raw_asset
            _object_uri_digest(raw_asset["artifact_uri"], raw_asset["sha256"])
            path = self._safe_object_path(raw_asset["artifact_uri"])
            self._require_file(path)
            try:
                actual_sha256 = self._dependencies.artifacts.sha256(path)
            except OSError as error:
                raise _RenderFailure(
                    "RENDER_ASSET_MISSING",
                    "A required accepted asset could not be read.",
                    retryable=False,
                ) from error
            if actual_sha256 != raw_asset["sha256"]:
                raise _RenderFailure(
                    "RENDER_ASSET_HASH_MISMATCH",
                    "An accepted asset exact-byte hash does not match its pointer.",
                    retryable=False,
                )
            paths[asset_id] = path

        if set(supplied) != set(expected):
            raise _RenderFailure(
                "RENDER_ASSET_MISSING",
                "Render input assets do not exactly cover the resolved manifest.",
                retryable=False,
            )
        for asset_id, binding in expected.items():
            supplied_asset = supplied[asset_id]
            if supplied_asset["sha256"] != binding.sha256 or supplied_asset["kind"] != binding.kind:
                raise _RenderFailure(
                    "RENDER_ASSET_HASH_MISMATCH",
                    "Render input asset facts do not match the resolved manifest.",
                    retryable=False,
                )
        voiceover_id = cast(dict[str, str], manifest["voiceover"])["asset_id"]
        return paths, paths[voiceover_id]

    def _probe_visual_assets(
        self,
        *,
        tools: RenderTools,
        manifest: Mapping[str, Any],
        paths: Mapping[str, Path],
        token: str,
    ) -> None:
        verified_checksums: set[str] = set()
        for binding in _expected_assets(manifest).values():
            if binding.kind == "VOICEOVER" or binding.sha256 in verified_checksums:
                continue
            path = paths[binding.asset_id]
            result = self._run_process(
                (
                    str(tools.ffprobe),
                    "-v",
                    "error",
                    "-show_streams",
                    "-of",
                    "json",
                    str(path),
                ),
                token=token,
                failure_code="RENDER_PROBE_FAILED",
            )
            try:
                payload = _parse_json_document(result.stdout.encode("utf-8"))
                streams = payload["streams"]
                if not isinstance(streams, list):
                    raise ValueError("Visual probe streams must be an array")
                video_streams = [
                    stream
                    for stream in streams
                    if isinstance(stream, dict) and stream.get("codec_type") == "video"
                ]
                other_streams = [
                    stream
                    for stream in streams
                    if not isinstance(stream, dict) or stream.get("codec_type") != "video"
                ]
                if len(video_streams) != 1 or other_streams:
                    raise ValueError("Visual inputs require exactly one video stream")
                video = cast(dict[str, Any], video_streams[0])
                codec = video.get("codec_name")
                if not isinstance(codec, str):
                    raise ValueError("Visual input codec is missing")
                if binding.kind == "IMAGE":
                    if codec not in IMAGE_CODECS:
                        raise ValueError("Image input does not use a still-image codec")
                else:
                    expected_profile = AVATAR_SOURCE_PROFILES.get(
                        binding.renderer_source_profile or ""
                    )
                    if expected_profile is None or codec in IMAGE_CODECS:
                        raise ValueError("Avatar input source profile is unsupported")
                    width, height, fps_num, fps_den = expected_profile
                    if video.get("width") != width or video.get("height") != height:
                        raise ValueError("Avatar input geometry does not match its source profile")
                    if _probe_frame_rate(video) != (fps_num, fps_den):
                        raise ValueError(
                            "Avatar input frame rate does not match its source profile"
                        )
            except (KeyError, TypeError, UnicodeEncodeError, ValueError) as error:
                raise _RenderFailure(
                    "RENDER_INPUT_INVALID",
                    "Accepted visual media does not match its declared kind or source profile.",
                    retryable=False,
                ) from error
            verified_checksums.add(binding.sha256)

    def _probe_output(
        self,
        *,
        tools: RenderTools,
        output_path: Path,
        expected_total_frames: int,
        token: str,
    ) -> ProbeFacts:
        probe_result = self._run_process(
            (
                str(tools.ffprobe),
                "-v",
                "error",
                "-count_frames",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(output_path),
            ),
            token=token,
            failure_code="RENDER_PROBE_FAILED",
        )
        try:
            facts = parse_ffprobe_facts(
                probe_result.stdout,
                expected_total_frames=expected_total_frames,
            )
        except ProbeValidationError as error:
            raise _RenderFailure(
                "RENDER_OUTPUT_INVALID",
                "Rendered output failed deterministic stream or timing checks.",
                retryable=False,
            ) from error

        self._run_process(
            (
                str(tools.ffmpeg),
                "-hide_banner",
                "-nostdin",
                "-v",
                "error",
                "-xerror",
                "-i",
                str(output_path),
                "-map",
                "0:v:0",
                "-map",
                "0:a:0",
                "-f",
                "null",
                "-",
            ),
            token=token,
            failure_code="RENDER_PROBE_FAILED",
        )
        return facts

    def _run_validated(self, document: dict[str, Any]) -> dict[str, Any]:
        token = cast(str, document["cancel_token"])
        self._check_cancelled(token)
        manifest = self._load_manifest(document)
        asset_paths, voiceover_path = self._resolve_assets(document, manifest)
        tools = self._resolve_tools(document)
        self._probe_visual_assets(
            tools=tools,
            manifest=manifest,
            paths=asset_paths,
            token=token,
        )
        input_loudness = self._measure_loudness(tools, voiceover_path, token)

        output = cast(dict[str, str], document["output"])
        expected_run_prefix = (
            f"vf-local-run://{document['project_revision_id']}/{document['attempt_id']}/"
        )
        if not output["result_uri"].startswith(expected_run_prefix) or not output[
            "result_uri"
        ].endswith(f"/{output['filename']}"):
            raise _RenderFailure(
                "RENDER_PATH_REJECTED",
                "Render destination is outside the claimed revision and attempt.",
                retryable=False,
            )
        output_path = self._safe_run_path(output["result_uri"])
        try:
            output_exists = self._dependencies.artifacts.exists(output_path)
        except OSError as error:
            raise _RenderFailure(
                "RENDER_OUTPUT_INVALID",
                "Render destination could not be checked safely.",
                retryable=False,
            ) from error
        if output_exists:
            raise _RenderFailure(
                "RENDER_OUTPUT_INVALID",
                "Render destination already exists and will not be overwritten.",
                retryable=False,
            )

        try:
            plan = compile_render_command(
                ffmpeg=tools.ffmpeg,
                manifest=manifest,
                asset_paths=asset_paths,
                voiceover_path=voiceover_path,
                output_path=output_path,
                input_loudness=input_loudness,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise _RenderFailure(
                "RENDER_INPUT_INVALID",
                "Resolved manifest could not be compiled into the fixed render profile.",
                retryable=False,
            ) from error

        self._run_process(
            plan.arguments,
            token=token,
            failure_code="RENDER_PROCESS_FAILED",
        )
        self._require_file(
            output_path,
            missing_code="RENDER_OUTPUT_INVALID",
            missing_message="Render process returned without producing an output file.",
        )
        try:
            output_sha256 = self._dependencies.artifacts.sha256(output_path)
            output_bytes = self._dependencies.artifacts.size(output_path)
        except OSError as error:
            raise _RenderFailure(
                "RENDER_OUTPUT_INVALID",
                "Rendered output could not be verified.",
                retryable=False,
            ) from error
        if output_bytes <= 0:
            raise _RenderFailure(
                "RENDER_OUTPUT_INVALID",
                "Rendered output is empty.",
                retryable=False,
            )

        total_frames = cast(int, manifest["total_frames"])
        facts = self._probe_output(
            tools=tools,
            output_path=output_path,
            expected_total_frames=total_frames,
            token=token,
        )
        output_loudness = self._measure_loudness(tools, output_path, token)
        if not (
            -17.0 <= output_loudness.integrated_lufs <= -15.0
            and output_loudness.true_peak_dbtp <= -1.5
        ):
            raise _RenderFailure(
                "RENDER_OUTPUT_INVALID",
                "Rendered output failed the fixed loudness policy.",
                retryable=False,
            )

        output_asset_id = f"asset_render_{output_sha256.removeprefix('sha256:')[:24]}"
        filtergraph_sha256 = (
            "sha256:" + hashlib.sha256(plan.filtergraph.encode("utf-8")).hexdigest()
        )
        probe = self._technical_probe(
            output_asset_id=output_asset_id,
            output_sha256=output_sha256,
            output_bytes=output_bytes,
            facts=facts,
            input_loudness=input_loudness,
            output_loudness=output_loudness,
            plan=plan,
            tools=tools,
            filtergraph_sha256=filtergraph_sha256,
        )

        self._check_cancelled(token)
        try:
            artifact_uri = self._dependencies.resolver.publish_object(
                output_path,
                output_sha256,
                "mp4",
            )
        except (OSError, ValueError) as error:
            raise _RenderFailure(
                "RENDER_OUTPUT_INVALID",
                "Rendered output could not be published immutably.",
                retryable=True,
            ) from error
        if artifact_uri != _expected_object_uri(output_sha256, "mp4"):
            raise _RenderFailure(
                "RENDER_OUTPUT_INVALID",
                "Published output URI does not bind the exact binary checksum.",
                retryable=False,
            )

        return _validated_result(
            {
                "schema_version": "render-job-result/v1",
                "attempt_id": document["attempt_id"],
                "status": "SUCCEEDED",
                "output": {
                    "asset_id": output_asset_id,
                    "sha256": output_sha256,
                    "bytes": output_bytes,
                    "artifact_uri": artifact_uri,
                    "filename": output["filename"],
                },
                "probe": probe,
                "error": None,
            }
        )

    @staticmethod
    def _technical_probe(
        *,
        output_asset_id: str,
        output_sha256: str,
        output_bytes: int,
        facts: ProbeFacts,
        input_loudness: LoudnessMeasurement,
        output_loudness: LoudnessMeasurement,
        plan: RenderCommandPlan,
        tools: RenderTools,
        filtergraph_sha256: str,
    ) -> dict[str, Any]:
        probe = {
            "schema_version": "technical-probe/v1",
            "asset_id": output_asset_id,
            "sha256": output_sha256,
            "bytes": output_bytes,
            "container": "mp4",
            "duration_ms": facts.duration_ms,
            "total_frames": facts.total_frames,
            "video": {
                "codec": "h264",
                "pixel_format": "yuv420p",
                "width": 1920,
                "height": 1080,
                "fps_num": 30,
                "fps_den": 1,
                "start_ms": facts.video_start_ms,
            },
            "audio": {
                "codec": "aac",
                "sample_rate_hz": 48_000,
                "channels": facts.audio_channels,
                "start_ms": facts.audio_start_ms,
            },
            "stream_counts": {"video": 1, "audio": 1, "subtitle": 0, "data": 0},
            "av_drift_ms": facts.av_drift_ms,
            "decode_ok": True,
            "loudness": {
                "profile": "voiceover-minus16lufs-v1",
                "normalized": plan.normalized,
                "input_integrated_lufs": input_loudness.integrated_lufs,
                "input_true_peak_dbtp": input_loudness.true_peak_dbtp,
                "output_integrated_lufs": output_loudness.integrated_lufs,
                "output_true_peak_dbtp": output_loudness.true_peak_dbtp,
            },
            "tools": {
                "ffmpeg_version": tools.ffmpeg_version,
                "ffprobe_version": tools.ffprobe_version,
                "filtergraph_sha256": filtergraph_sha256,
            },
        }
        try:
            return cast(dict[str, Any], validate_contract("technicalProbe", probe))
        except ContractValidationError as error:
            raise _RenderFailure(
                "RENDER_OUTPUT_INVALID",
                "Technical probe facts could not be represented by the canonical contract.",
                retryable=False,
            ) from error
