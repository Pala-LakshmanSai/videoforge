from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, cast

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from ._schema_documents import SCHEMA_DOCUMENTS

ContractName = Literal[
    "avatarProfileVersion",
    "createProjectRequest",
    "imageStyleProfile",
    "imageStyleAnalyzerOutput",
    "projectRevisionConfig",
    "timelinePlan",
    "resolvedRenderManifest",
    "productionManifest",
]

CONTRACT_NAMES: tuple[ContractName, ...] = (
    "avatarProfileVersion",
    "createProjectRequest",
    "imageStyleProfile",
    "imageStyleAnalyzerOutput",
    "projectRevisionConfig",
    "timelinePlan",
    "resolvedRenderManifest",
    "productionManifest",
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


def validate_contract(contract_name: ContractName, value: Any) -> Any:
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
    return value
