from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from videoforge_contracts import (
    CONTRACT_MODELS,
    CONTRACT_NAMES,
    CONTRACT_VALIDATORS,
    ContractName,
    ContractValidationError,
    CreateProjectRequest,
    validate_contract,
)

CONTRACT_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = CONTRACT_ROOT / "generated" / "fixtures"

FIXTURE_CASES: tuple[tuple[ContractName, str, bool], ...] = (
    ("avatarProfileVersion", "avatar_profile_version.valid.json", True),
    ("createProjectRequest", "create_project_request.valid.json", True),
    (
        "createProjectRequest",
        "create_project_request.invalid.inline_avatar.json",
        False,
    ),
    ("orchestrationState", "orchestration_state.valid.json", True),
    (
        "orchestrationState",
        "orchestration_state.invalid.unhashed_outbox.json",
        False,
    ),
    (
        "createProjectRequest",
        "create_project_request.invalid.over_budget.json",
        False,
    ),
    ("projectRevisionConfig", "project_revision_config.valid.json", True),
    (
        "projectRevisionConfig",
        "project_revision_config.invalid.compatibility_mismatch.json",
        False,
    ),
    ("timelinePlan", "timeline_plan.valid.json", True),
    ("resolvedRenderManifest", "resolved_render_manifest.valid.json", True),
    (
        "resolvedRenderManifest",
        "resolved_render_manifest.invalid.avatar_profile_crop.json",
        False,
    ),
    ("productionManifest", "production_manifest.valid.json", True),
    ("imageStyleProfile", "default_image_style_v1.json", True),
    ("workerJobEnvelope", "worker_job_envelope.valid.json", True),
    (
        "workerJobEnvelope",
        "worker_job_envelope.invalid.shell_args.json",
        False,
    ),
)


def load_fixture(filename: str) -> Any:
    return json.loads((FIXTURE_ROOT / filename).read_text(encoding="utf-8"))


def test_all_canonical_schemas_compile() -> None:
    assert set(CONTRACT_NAMES) == set(CONTRACT_VALIDATORS)
    assert len(CONTRACT_NAMES) == 10


def test_fixture_matrix_covers_every_synchronized_fixture() -> None:
    actual = sorted(path.name for path in FIXTURE_ROOT.glob("*.json"))
    expected = sorted(filename for _, filename, _ in FIXTURE_CASES)
    assert actual == expected


@pytest.mark.parametrize(("contract_name", "filename", "expected"), FIXTURE_CASES)
def test_fixture_contract_validation(
    contract_name: ContractName,
    filename: str,
    expected: bool,
) -> None:
    fixture = load_fixture(filename)
    if expected:
        assert validate_contract(contract_name, fixture) is fixture
        model = CONTRACT_MODELS[contract_name].model_validate(fixture)
        assert model is not None
    else:
        with pytest.raises(ContractValidationError) as error:
            validate_contract(contract_name, fixture)
        assert error.value.issues
        with pytest.raises(ValidationError):
            CONTRACT_MODELS[contract_name].model_validate(fixture)


def test_typed_create_project_model_rejects_inline_avatar() -> None:
    valid = load_fixture("create_project_request.valid.json")
    parsed = CreateProjectRequest.model_validate(valid)
    assert parsed.avatar_profile_version_id == "avatar_profile_version_fixture_001"

    invalid = load_fixture("create_project_request.invalid.inline_avatar.json")
    with pytest.raises(ValidationError):
        CreateProjectRequest.model_validate(invalid)


def test_typed_create_project_model_enforces_conditional_keywords() -> None:
    invalid = {
        **load_fixture("create_project_request.valid.json"),
        "apply_extra_prompt_keywords": True,
        "extra_prompt_keywords": "   ",
    }
    with pytest.raises(ValidationError):
        CreateProjectRequest.model_validate(invalid)
