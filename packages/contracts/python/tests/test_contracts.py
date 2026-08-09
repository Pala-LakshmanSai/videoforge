from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

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

CONTRACT_INDEX = json.loads(
    (CONTRACT_ROOT / "generated" / "contract-index.v1.json").read_text(encoding="utf-8")
)
FIXTURE_CASES: tuple[tuple[ContractName, str, bool], ...] = tuple(
    (
        cast(ContractName, contract["name"]),
        Path(fixture["path"]).name,
        fixture["expected"],
    )
    for contract in CONTRACT_INDEX["contracts"]
    for fixture in contract["fixtures"]
)


def load_fixture(filename: str) -> Any:
    return json.loads((FIXTURE_ROOT / filename).read_text(encoding="utf-8"))


def test_all_canonical_schemas_compile() -> None:
    assert set(CONTRACT_NAMES) == set(CONTRACT_VALIDATORS)
    assert len(CONTRACT_NAMES) == 16


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


def test_python_rejects_non_finite_numbers_like_ajv() -> None:
    invalid = load_fixture("technical_probe.valid.json")
    invalid["loudness"]["input_integrated_lufs"] = float("nan")

    with pytest.raises(ContractValidationError) as error:
        validate_contract("technicalProbe", invalid)

    assert error.value.issues[0].validator == "finite"
    with pytest.raises(ValidationError):
        CONTRACT_MODELS["technicalProbe"].model_validate(invalid)


@pytest.mark.parametrize(
    ("contract_name", "filename", "mutate"),
    [
        (
            "transcriptTiming",
            "transcript_timing.valid.json",
            lambda value: value["words"][0].update(start_ms=value["words"][0]["end_ms"]),
        ),
        (
            "asrJobResult",
            "asr_job_result.valid.json",
            lambda value: value.update(source_voiceover_sha256="sha256:" + "f" * 64),
        ),
        (
            "renderJobResult",
            "render_job_result.valid.json",
            lambda value: value["output"].update(bytes=value["output"]["bytes"] + 1),
        ),
    ],
)
def test_semantic_validation_rejects_contradictory_media_facts(
    contract_name: ContractName,
    filename: str,
    mutate: Any,
) -> None:
    invalid = load_fixture(filename)
    mutate(invalid)

    with pytest.raises(ContractValidationError) as error:
        validate_contract(contract_name, invalid)

    assert any(issue.validator == "semantic" for issue in error.value.issues)
    with pytest.raises(ValidationError):
        CONTRACT_MODELS[contract_name].model_validate(invalid)
