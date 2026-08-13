from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal, cast

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from ._schema_documents import SCHEMA_DOCUMENTS

ContractName = Literal[
    "admittedIdentity",
    "avatarProfileVersion",
    "createProjectRequest",
    "durableTimingLineage",
    "globalGenerationSession",
    "imageStyleProfile",
    "imageStyleAnalyzerOutput",
    "orchestrationState",
    "projectRevisionConfig",
    "timelinePlan",
    "generationWorkManifest",
    "renderWorkManifest",
    "resolvedRenderManifest",
    "productionManifest",
    "podWorkerJobEnvelope",
    "workerJobEnvelope",
    "transcriptTiming",
    "asrJobInput",
    "asrJobResult",
    "renderJobInput",
    "technicalProbe",
    "renderJobResult",
]

CONTRACT_NAMES: tuple[ContractName, ...] = (
    "admittedIdentity",
    "avatarProfileVersion",
    "createProjectRequest",
    "durableTimingLineage",
    "globalGenerationSession",
    "imageStyleProfile",
    "imageStyleAnalyzerOutput",
    "orchestrationState",
    "projectRevisionConfig",
    "timelinePlan",
    "generationWorkManifest",
    "renderWorkManifest",
    "resolvedRenderManifest",
    "productionManifest",
    "podWorkerJobEnvelope",
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
    if contract_name == "admittedIdentity":
        normalized_email = cast(str, value["normalized_email"])
        if normalized_email != normalized_email.strip().lower():
            return (
                _semantic_issue(
                    "/normalized_email", "Admitted email must be normalized lowercase text."
                ),
            )
        return ()
    if contract_name == "globalGenerationSession":
        issues: list[ContractIssue] = []
        session = cast(dict[str, Any], value["session"])
        selections = cast(dict[str, dict[str, Any]], session["gpu_pair"])
        lanes = ("mage_image", "echo_avatar")
        for lane in lanes:
            selection = selections[lane]
            receipt = cast(dict[str, Any], selection["receipt"])
            path = f"/session/gpu_pair/{lane}"
            if selection["lane"] != lane:
                issues.append(
                    _semantic_issue(f"{path}/lane", "GPU selection lane must match its pair slot.")
                )
            observed_at = cast(str, receipt["observed_at"])
            expires_at = cast(str, receipt["expires_at"])
            revalidated_at = cast(str, selection["revalidated_at"])
            if observed_at >= expires_at:
                issues.append(
                    _semantic_issue(
                        f"{path}/receipt/expires_at",
                        "Inventory receipt must expire after observation.",
                    )
                )
            if revalidated_at < observed_at or revalidated_at > expires_at:
                issues.append(
                    _semantic_issue(
                        f"{path}/revalidated_at",
                        "GPU revalidation must fall inside the live inventory receipt window.",
                    )
                )
            if (
                receipt["observed_rate_micro_usd_per_hour"]
                > selection["rate_ceiling_micro_usd_per_hour"]
            ):
                issues.append(
                    _semantic_issue(
                        f"{path}/rate_ceiling_micro_usd_per_hour",
                        "Observed GPU rate must not exceed the locked ceiling.",
                    )
                )

        queue = cast(dict[str, Any], value["queue"])
        entries = cast(list[dict[str, Any]], queue["entries"])
        live_entries = sorted(
            (entry for entry in entries if entry["state"] in ("ACTIVE", "WAITING")),
            key=lambda entry: cast(int, entry["position"]),
        )
        active_entries = [entry for entry in live_entries if entry["state"] == "ACTIVE"]
        if len(active_entries) > 1:
            issues.append(
                _semantic_issue(
                    "/queue/entries", "Global queue may contain at most one active entry."
                )
            )
        for index, entry in enumerate(live_entries):
            if entry["position"] != index:
                issues.append(
                    _semantic_issue(
                        f"/queue/entries/{index}/position",
                        "Live queue positions must be contiguous.",
                    )
                )
            if entry["inherited_gpu_pair_hash"] != session["gpu_pair_hash"]:
                issues.append(
                    _semantic_issue(
                        f"/queue/entries/{index}/inherited_gpu_pair_hash",
                        "Every queue entry must inherit the immutable session GPU pair.",
                    )
                )
            if entry["state"] == "WAITING" and (
                entry["compute_run_plan_id"] is not None or entry["executable_fact_count"] != 0
            ):
                issues.append(
                    _semantic_issue(
                        f"/queue/entries/{index}",
                        "Waiting queue entries must remain orchestration-inert.",
                    )
                )
        if active_entries and active_entries[0]["position"] != 0:
            issues.append(
                _semantic_issue("/queue/entries", "Active queue entry must occupy position zero.")
            )
        project_revision_ids = [entry["project_revision_id"] for entry in entries]
        if len(set(project_revision_ids)) != len(project_revision_ids):
            issues.append(
                _semantic_issue(
                    "/queue/entries", "A project revision may appear in the queue only once."
                )
            )

        volumes = cast(dict[str, dict[str, Any]], value["lane_volumes"])
        mage_volume = volumes["mage_image"]
        echo_volume = volumes["echo_avatar"]
        if (
            mage_volume["model_volume_id"] == echo_volume["model_volume_id"]
            or mage_volume["provider_volume_id"] == echo_volume["provider_volume_id"]
            or mage_volume["manifest_id"] == echo_volume["manifest_id"]
        ):
            issues.append(
                _semantic_issue(
                    "/lane_volumes", "Mage and Echo volumes and manifests must remain isolated."
                )
            )

        lane_states = cast(dict[str, dict[str, Any]], value["lane_states"])
        for lane in lanes:
            lane_state = lane_states[lane]
            selection = selections[lane]
            volume = volumes[lane]
            path = f"/lane_states/{lane}"
            if lane_state["lane"] != lane:
                issues.append(
                    _semantic_issue(f"{path}/lane", "Lane state must match its lane slot.")
                )
            active_queue_entry_id = lane_state["active_queue_entry_id"]
            if active_queue_entry_id is not None and not any(
                entry["queue_entry_id"] == active_queue_entry_id for entry in active_entries
            ):
                issues.append(
                    _semantic_issue(
                        f"{path}/active_queue_entry_id",
                        "Lane demand may reference only the active global queue entry.",
                    )
                )
            if lane_state["demand"] == "ACTIVE" and active_queue_entry_id is None:
                issues.append(
                    _semantic_issue(
                        f"{path}/active_queue_entry_id",
                        "Active lane demand requires an active entry.",
                    )
                )
            if lane_state["demand"] == "WAITING_WARM" and not any(
                entry["state"] == "WAITING" for entry in live_entries
            ):
                issues.append(
                    _semantic_issue(
                        f"{path}/demand",
                        "Warm retention requires at least one waiting queue entry.",
                    )
                )
            attempts = cast(list[dict[str, Any]], lane_state["pod_attempts"])
            for index, attempt in enumerate(attempts):
                attempt_path = f"{path}/pod_attempts/{index}"
                if (
                    attempt["model_volume_id"] != volume["model_volume_id"]
                    or attempt["manifest_sha256"] != volume["manifest_sha256"]
                ):
                    issues.append(
                        _semantic_issue(
                            f"{attempt_path}/model_volume_id",
                            "Pod attempt must bind the exact isolated lane volume manifest.",
                        )
                    )
                actual_gpu = attempt["actual_gpu_sku"]
                if actual_gpu is not None and actual_gpu != attempt["selected_gpu_sku"]:
                    issues.append(
                        _semantic_issue(
                            f"{attempt_path}/actual_gpu_sku",
                            "Actual Pod GPU must equal the session-selected GPU.",
                        )
                    )
                if attempt["selected_gpu_sku"] != selection["receipt"]["gpu_sku"]:
                    issues.append(
                        _semantic_issue(
                            f"{attempt_path}/selected_gpu_sku",
                            "Pod attempt must use the immutable session GPU selection.",
                        )
                    )
                if attempt["model_ready"] and (
                    attempt["create_status"] != "ACKNOWLEDGED"
                    or attempt["provider_pod_id"] is None
                    or not attempt["container_ready"]
                    or not attempt["volume_verified"]
                    or not attempt["warmup_passed"]
                    or actual_gpu != selection["receipt"]["gpu_sku"]
                ):
                    issues.append(
                        _semantic_issue(
                            f"{attempt_path}/model_ready",
                            "Model ready requires acknowledged identity, exact GPU/volume, "
                            "container, and warm-up.",
                        )
                    )
                if attempt["create_status"] in ("ACK_UNKNOWN", "AMBIGUOUS") and (
                    attempt["model_ready"] or attempt["delete_status"] == "ABSENCE_VERIFIED"
                ):
                    issues.append(
                        _semantic_issue(
                            f"{attempt_path}/create_status",
                            "Ambiguous create cannot imply model readiness or "
                            "authoritative absence.",
                        )
                    )
                if (attempt["delete_status"] == "ABSENCE_VERIFIED") != (
                    attempt["absence_receipt"] is not None
                ):
                    issues.append(
                        _semantic_issue(
                            f"{attempt_path}/absence_receipt",
                            "Only an authoritative absence receipt proves Pod deletion.",
                        )
                    )
            if lane_state["demand"] == "WAITING_WARM":
                latest = attempts[-1] if attempts else None
                if (
                    latest is None
                    or not latest["model_ready"]
                    or latest["delete_status"] != "NOT_REQUESTED"
                ):
                    issues.append(
                        _semantic_issue(
                            f"{path}/demand",
                            "Waiting demand may retain only an already model-ready Pod.",
                        )
                    )

        if session["state"] == "ACTIVE" and (
            session["closing_at"] is not None or session["closed_at"] is not None
        ):
            issues.append(
                _semantic_issue("/session/state", "Active session cannot carry closing timestamps.")
            )
        if session["state"] == "DRAINING" and session["closing_at"] is None:
            issues.append(
                _semantic_issue("/session/closing_at", "Draining session requires closing time.")
            )
        if session["state"] == "CLOSED":
            if session["closing_at"] is None or session["closed_at"] is None or live_entries:
                issues.append(
                    _semantic_issue(
                        "/session/state",
                        "Closed session requires timestamps and an empty active/waiting queue.",
                    )
                )
            for lane in lanes:
                lane_state = lane_states[lane]
                attempts = cast(list[dict[str, Any]], lane_state["pod_attempts"])
                latest = attempts[-1] if attempts else None
                if (
                    lane_state["demand"] != "ZERO"
                    or latest is None
                    or latest["delete_status"] != "ABSENCE_VERIFIED"
                ):
                    issues.append(
                        _semantic_issue(
                            f"/lane_states/{lane}",
                            "Closed session requires zero demand and proven Pod absence "
                            "in both lanes.",
                        )
                    )

        events = cast(list[dict[str, Any]], value["events"])
        for index, event in enumerate(events):
            if event["sequence"] != index + 1:
                issues.append(
                    _semantic_issue(
                        f"/events/{index}/sequence", "Event sequence must be contiguous."
                    )
                )
        cost_summary = cast(dict[str, Any], value["cost_summary"])
        amounts = {"RESERVED": 0, "REPORTED": 0, "SETTLED": 0}
        for event in cost_summary["events"]:
            amounts[event["stage"]] += event["amount_micro_usd"]
        if (
            amounts["RESERVED"] != cost_summary["reserved_micro_usd"]
            or amounts["REPORTED"] != cost_summary["reported_micro_usd"]
            or amounts["SETTLED"] != cost_summary["settled_micro_usd"]
        ):
            issues.append(
                _semantic_issue("/cost_summary", "Cost summary must equal its append-only events.")
            )
        if (
            max(
                cost_summary["reserved_micro_usd"],
                cost_summary["reported_micro_usd"],
                cost_summary["settled_micro_usd"],
            )
            > cost_summary["hard_ceiling_micro_usd"]
        ):
            issues.append(
                _semantic_issue("/cost_summary", "Cost totals must not exceed the hard ceiling.")
            )
        return tuple(issues)
    if contract_name == "podWorkerJobEnvelope":
        binding = cast(dict[str, Any], value["pod_resource_binding"])
        input_manifest = cast(dict[str, Any], value["input_manifest"])
        issues: list[ContractIssue] = []
        if value["lane"] != binding["lane"]:
            issues.append(
                _semantic_issue(
                    "/pod_resource_binding/lane",
                    "Pod binding lane must match envelope lane.",
                )
            )
        if value["lane"] == "mage_image":
            matches = (
                binding["worker_contract"] == "videoforge-mage-pod/v1"
                and binding["model_id"] == "Comfy-Org/Mage-Flow"
                and binding["model_revision"] == "d8c99241f6fa80fbd453014234af2bf337ea21e6"
                and binding["precision"] == "int8-convrot"
                and binding["mount_path"] == "/models/mage"
            )
        else:
            matches = (
                binding["worker_contract"] == "videoforge-echo-pod/v1"
                and binding["model_id"] == "EchoMimicV3-Flash"
                and binding["precision"] == "fp8"
                and binding["mount_path"] == "/models/echo"
            )
        if not matches:
            issues.append(
                _semantic_issue(
                    "/pod_resource_binding",
                    "Pod binding must match the exact isolated vNext lane profile.",
                )
            )
        expected_artifact_id = ":".join(
            (
                "dispatch-input",
                value["generation_session_id"],
                value["queue_entry_id"],
                value["compute_run_plan_id"],
                value["lane"],
                binding["pod_attempt_id"],
            )
        )
        if (
            input_manifest["artifact_id"] != expected_artifact_id
            or input_manifest["generation_session_id"] != value["generation_session_id"]
            or input_manifest["queue_entry_id"] != value["queue_entry_id"]
            or input_manifest["compute_run_plan_id"] != value["compute_run_plan_id"]
            or input_manifest["lane"] != value["lane"]
            or input_manifest["pod_attempt_id"] != binding["pod_attempt_id"]
        ):
            issues.append(
                _semantic_issue(
                    "/input_manifest",
                    "Dispatch input must bind to the exact session, queue entry, "
                    "run plan, lane, and Pod attempt.",
                )
            )
        expected_output_prefix = (
            f"sessions/{value['generation_session_id']}/queue/{value['queue_entry_id']}"
            f"/runs/{value['compute_run_plan_id']}/{value['lane']}"
            f"/pods/{binding['pod_attempt_id']}/"
        )
        if value["output_prefix"] != expected_output_prefix:
            issues.append(
                _semantic_issue(
                    "/output_prefix",
                    "Dispatch output prefix must bind to the exact session, queue entry, "
                    "run plan, lane, and Pod attempt.",
                )
            )
        return tuple(issues)
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
    if contract_name == "generationWorkManifest":
        issues = []
        batch_ids: set[str] = set()
        batched_task_keys: set[str] = set()
        for index, batch in enumerate(value["prompt_batches"]):
            if batch["ordinal"] != index or batch["batch_id"] in batch_ids:
                issues.append(
                    _semantic_issue(
                        f"/prompt_batches/{index}",
                        "Prompt batches must have unique IDs and contiguous zero-based ordinals.",
                    )
                )
            batch_ids.add(batch["batch_id"])
            for task_key in batch["scene_task_keys"]:
                if task_key in batched_task_keys:
                    issues.append(
                        _semantic_issue(
                            f"/prompt_batches/{index}/scene_task_keys",
                            "Each image task must appear in exactly one prompt batch.",
                        )
                    )
                batched_task_keys.add(task_key)
        image_task_keys: set[str] = set()
        image_ids: set[str] = set()
        for index, slot in enumerate(value["image_slots"]):
            if (
                slot["task_key"] in image_task_keys
                or slot["slot_id"] in image_ids
                or slot["prompt_batch_id"] not in batch_ids
                or slot["task_key"] not in batched_task_keys
            ):
                issues.append(
                    _semantic_issue(
                        f"/image_slots/{index}",
                        "Image slots must be unique and bound to exactly one "
                        "declared prompt batch.",
                    )
                )
            image_task_keys.add(slot["task_key"])
            image_ids.add(slot["slot_id"])
        if image_task_keys != batched_task_keys:
            issues.append(
                _semantic_issue(
                    "/prompt_batches",
                    "Prompt batches and image slots must cover the same task-key set exactly once.",
                )
            )
        avatar_task_keys: set[str] = set()
        avatar_segments: set[str] = set()
        for index, span in enumerate(value["avatar_spans"]):
            if (
                span["task_key"] in avatar_task_keys
                or span["timeline_segment_id"] in avatar_segments
                or span["padded_start_ms"] > span["selected_start_ms"]
                or span["selected_start_ms"] >= span["selected_end_ms_exclusive"]
                or span["selected_end_ms_exclusive"] > span["padded_end_ms_exclusive"]
                or span["trim_start_ms"] != span["selected_start_ms"] - span["padded_start_ms"]
                or span["trim_end_ms_exclusive"]
                != span["trim_start_ms"]
                + span["selected_end_ms_exclusive"]
                - span["selected_start_ms"]
            ):
                issues.append(
                    _semantic_issue(
                        f"/avatar_spans/{index}",
                        "Avatar span work must be unique and preserve exact selected, "
                        "padded, and trim timing.",
                    )
                )
            avatar_task_keys.add(span["task_key"])
            avatar_segments.add(span["timeline_segment_id"])
        counts = value["cost_counts"]
        selected_audio_ms = sum(
            span["padded_end_ms_exclusive"] - span["padded_start_ms"]
            for span in value["avatar_spans"]
        )
        if (
            counts["prompt_batch_count"] != len(value["prompt_batches"])
            or counts["image_prompt_count"] != len(value["image_slots"])
            or counts["image_generation_count"] != len(value["image_slots"])
            or counts["avatar_generation_count"] != len(value["avatar_spans"])
            or counts["selected_span_audio_count"] != len(value["avatar_spans"])
            or counts["selected_span_audio_ms"] != selected_audio_ms
        ):
            issues.append(
                _semantic_issue(
                    "/cost_counts", "Cost counts must equal the exact immutable work units."
                )
            )
        return tuple(issues)
    if contract_name == "renderWorkManifest":
        issues = []
        segment_ids: set[str] = set()
        next_frame = 0
        for index, segment in enumerate(value["segments"]):
            composition = segment["timeline_composition"]
            expected_asset_keys = (
                {"avatar"}
                if composition == "AVATAR_FULL"
                else {"image"}
                if composition == "IMAGE_FULL"
                else {"avatar", "image"}
            )
            needs_image = composition != "AVATAR_FULL"
            needs_avatar = composition != "IMAGE_FULL"
            if (
                segment["timeline_segment_id"] in segment_ids
                or segment["start_frame"] != next_frame
                or segment["end_frame_exclusive"] <= segment["start_frame"]
                or set(segment["planned_asset_ids"]) != expected_asset_keys
                or segment["image_zoom_profile"]
                != ("SLOW_SMOOTH_CENTERED_ZOOM" if needs_image else "NONE")
                or segment["avatar_crop_authority"]
                != ("ACCEPTED_ECHO_PROFILE_REQUIRED" if needs_avatar else "NOT_APPLICABLE")
            ):
                issues.append(
                    _semantic_issue(
                        f"/segments/{index}",
                        "Render work must be contiguous and composition-specific with "
                        "hard-cut image zoom and Echo crop authority.",
                    )
                )
            segment_ids.add(segment["timeline_segment_id"])
            next_frame = segment["end_frame_exclusive"]
        if next_frame != value["output"]["total_frames"]:
            issues.append(
                _semantic_issue(
                    "/segments", "Render work must cover every output frame exactly once."
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
