from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal, cast

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from ._schema_documents import SCHEMA_DOCUMENTS

ContractName = Literal[
    "avatarProfileVersion",
    "createProjectRequest",
    "durableTimingLineage",
    "imageStyleProfile",
    "imageStyleAnalyzerOutput",
    "orchestrationState",
    "projectRevisionConfig",
    "timelinePlan",
    "resolvedRenderManifest",
    "productionManifest",
    "workerJobEnvelope",
    "transcriptTiming",
    "asrJobInput",
    "asrJobResult",
    "renderJobInput",
    "technicalProbe",
    "renderJobResult",
]

CONTRACT_NAMES: tuple[ContractName, ...] = (
    "avatarProfileVersion",
    "createProjectRequest",
    "durableTimingLineage",
    "imageStyleProfile",
    "imageStyleAnalyzerOutput",
    "orchestrationState",
    "projectRevisionConfig",
    "timelinePlan",
    "resolvedRenderManifest",
    "productionManifest",
    "workerJobEnvelope",
    "transcriptTiming",
    "asrJobInput",
    "asrJobResult",
    "renderJobInput",
    "technicalProbe",
    "renderJobResult",
)


@dataclass(frozen=True)
class ContractIssue:
    json_path: str
    schema_path: str
    validator: str
    message: str


class ContractValidationError(ValueError):
    def __init__(self, contract_name: ContractName, issues: tuple[ContractIssue, ...]) -> None:
        self.contract_name = contract_name
        self.issues = issues
        suffix = "" if len(issues) == 1 else "s"
        super().__init__(f"Invalid {contract_name} contract ({len(issues)} issue{suffix}).")


for schema in SCHEMA_DOCUMENTS.values():
    Draft202012Validator.check_schema(schema)

_registry = Registry().with_resources(
    (
        cast(str, schema["$id"]),
        Resource.from_contents(schema),
    )
    for schema in SCHEMA_DOCUMENTS.values()
)

CONTRACT_VALIDATORS: dict[ContractName, Draft202012Validator] = {
    name: Draft202012Validator(SCHEMA_DOCUMENTS[name], registry=_registry)
    for name in CONTRACT_NAMES
}


def _find_non_finite_numbers(value: Any, path: str = "$") -> tuple[ContractIssue, ...]:
    if isinstance(value, float) and not math.isfinite(value):
        return (
            ContractIssue(
                json_path=path,
                schema_path="",
                validator="finite",
                message="JSON numbers must be finite",
            ),
        )
    if isinstance(value, dict):
        return tuple(
            issue
            for key, child in value.items()
            for issue in _find_non_finite_numbers(child, f"{path}.{key}")
        )
    if isinstance(value, list | tuple):
        return tuple(
            issue
            for index, child in enumerate(value)
            for issue in _find_non_finite_numbers(child, f"{path}[{index}]")
        )
    return ()


def _semantic_issue(json_path: str, message: str) -> ContractIssue:
    return ContractIssue(
        json_path=json_path,
        schema_path="#/$semantic",
        validator="semantic",
        message=message,
    )


def _transcript_timing_issues(
    transcript: dict[str, Any], prefix: str = ""
) -> tuple[ContractIssue, ...]:
    issues: list[ContractIssue] = []
    words = cast(list[dict[str, Any]], transcript["words"])
    previous_word_end = 0
    for index, word in enumerate(words):
        word_path = f"{prefix}/words/{index}"
        if word["index"] != index:
            issues.append(
                _semantic_issue(
                    f"{word_path}/index", "Word indices must be contiguous and zero-based."
                )
            )
        if word["start_ms"] >= word["end_ms"]:
            issues.append(_semantic_issue(word_path, "Word start_ms must be before end_ms."))
        if index > 0 and word["start_ms"] < previous_word_end:
            issues.append(
                _semantic_issue(f"{word_path}/start_ms", "Words must not overlap or move backward.")
            )
        if word["end_ms"] > transcript["source"]["duration_ms"]:
            issues.append(
                _semantic_issue(f"{word_path}/end_ms", "Words must stay within source duration.")
            )
        previous_word_end = word["end_ms"]

    expected_word_start = 0
    phrases = cast(list[dict[str, Any]], transcript["phrases"])
    for index, phrase in enumerate(phrases):
        phrase_path = f"{prefix}/phrases/{index}"
        if phrase["word_start"] != expected_word_start:
            issues.append(
                _semantic_issue(
                    f"{phrase_path}/word_start", "Phrases must cover words contiguously."
                )
            )
        if phrase["word_end_exclusive"] <= phrase["word_start"] or phrase[
            "word_end_exclusive"
        ] > len(words):
            issues.append(
                _semantic_issue(
                    phrase_path, "Phrase word bounds must identify a non-empty word span."
                )
            )
        else:
            first_word = words[phrase["word_start"]]
            last_word = words[phrase["word_end_exclusive"] - 1]
            if (
                phrase["start_ms"] != first_word["start_ms"]
                or phrase["end_ms"] != last_word["end_ms"]
            ):
                issues.append(
                    _semantic_issue(
                        phrase_path, "Phrase timing must bind exactly to its word span."
                    )
                )
        if phrase["start_ms"] >= phrase["end_ms"]:
            issues.append(_semantic_issue(phrase_path, "Phrase start_ms must be before end_ms."))
        expected_word_start = phrase["word_end_exclusive"]
    if expected_word_start != len(words):
        issues.append(
            _semantic_issue(f"{prefix}/phrases", "Phrases must cover every transcript word once.")
        )
    return tuple(issues)


def _semantic_contract_issues(
    contract_name: ContractName, value: dict[str, Any]
) -> tuple[ContractIssue, ...]:
    if contract_name == "transcriptTiming":
        return _transcript_timing_issues(value)
    if contract_name == "asrJobResult" and value["status"] == "SUCCEEDED":
        transcript = cast(dict[str, Any], value["transcript"])
        issues = list(_transcript_timing_issues(transcript, "/transcript"))
        if value["source_voiceover_sha256"] != transcript["source"]["sha256"]:
            issues.append(
                _semantic_issue(
                    "/source_voiceover_sha256",
                    "Result source hash must match the transcript source hash.",
                )
            )
        if value["model_sha256"] != transcript["engine"]["model_sha256"]:
            issues.append(
                _semantic_issue(
                    "/model_sha256", "Result model hash must match the transcript model hash."
                )
            )
        if value["diagnostics"]["source_duration_ms"] != transcript["source"]["duration_ms"]:
            issues.append(
                _semantic_issue(
                    "/diagnostics/source_duration_ms",
                    "Diagnostic duration must match the transcript source duration.",
                )
            )
        return tuple(issues)
    if contract_name == "renderJobResult" and value["status"] == "SUCCEEDED":
        issues = []
        for field in ("asset_id", "sha256", "bytes"):
            if value["output"][field] != value["probe"][field]:
                issues.append(
                    _semantic_issue(
                        f"/output/{field}",
                        f"Render output {field} must match its technical probe.",
                    )
                )
        return tuple(issues)
    if contract_name == "resolvedRenderManifest":
        expected_suffix = value["render_profile_version"].rsplit("-", maxsplit=1)[-1]
        issues = []
        for index, segment in enumerate(value["segments"]):
            if (
                segment["timeline_composition"] == "IMAGE_FULL"
                and segment["render"]["zoom_profile"] != f"image-full-zoom-{expected_suffix}"
            ):
                issues.append(
                    _semantic_issue(
                        f"/segments/{index}/render/zoom_profile",
                        "Full-image zoom profile must match the render profile version.",
                    )
                )
            if (
                segment["timeline_composition"] == "AVATAR_SPLIT_IMAGE"
                and segment["render"]["right_image_zoom_profile"]
                != f"split-right-zoom-{expected_suffix}"
            ):
                issues.append(
                    _semantic_issue(
                        f"/segments/{index}/render/right_image_zoom_profile",
                        "Split-image zoom profile must match the render profile version.",
                    )
                )
        return tuple(issues)
    return ()


def validate_contract(contract_name: ContractName, value: Any) -> Any:
    non_finite_issues = _find_non_finite_numbers(value)
    if non_finite_issues:
        raise ContractValidationError(contract_name, non_finite_issues)
    validator = CONTRACT_VALIDATORS[contract_name]
    errors = sorted(validator.iter_errors(value), key=lambda error: error.json_path)
    if errors:
        issues = tuple(
            ContractIssue(
                json_path=error.json_path,
                schema_path="/".join(str(part) for part in error.absolute_schema_path),
                validator=str(error.validator),
                message=error.message,
            )
            for error in errors
        )
        raise ContractValidationError(contract_name, issues)
    semantic_issues = _semantic_contract_issues(contract_name, cast(dict[str, Any], value))
    if semantic_issues:
        raise ContractValidationError(contract_name, semantic_issues)
    return value
