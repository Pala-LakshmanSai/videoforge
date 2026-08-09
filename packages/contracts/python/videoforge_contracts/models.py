from __future__ import annotations

from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, model_validator

from .validator import ContractName, validate_contract

GenerationMode = Literal["LOWEST_COST", "BALANCED", "FASTER"]


class ExecutionProfileOverrides(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    image_media_profile_id: str | None = None
    avatar_primary_profile_id: str | None = None
    avatar_repair_profile_id: str | None = None
    avatar_quality_profile_id: str | None = None


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    title: str
    voiceover_asset_id: str
    avatar_profile_version_id: str
    image_style_version_id: str
    optional_script: str | None = None
    extra_prompt_keywords: str | None
    apply_extra_prompt_keywords: bool
    generation_mode: GenerationMode
    execution_profile_overrides: ExecutionProfileOverrides | None = None
    spend_cap_usd: float = Field(ge=0.1, le=2)
    user_seed: int | None = Field(default=None, ge=0, le=4_294_967_295)

    @model_validator(mode="before")
    @classmethod
    def validate_canonical_schema(cls, value: Any) -> Any:
        if isinstance(value, cls):
            return value
        return validate_contract("createProjectRequest", value)


class CanonicalContractDocument(RootModel[dict[str, Any]]):
    contract_name: ClassVar[ContractName]

    @model_validator(mode="before")
    @classmethod
    def validate_canonical_schema(cls, value: Any) -> Any:
        if isinstance(value, cls):
            return value.root
        return validate_contract(cls.contract_name, value)


class AvatarProfileVersionDocument(CanonicalContractDocument):
    contract_name = "avatarProfileVersion"


class ImageStyleProfileDocument(CanonicalContractDocument):
    contract_name = "imageStyleProfile"


class ImageStyleAnalyzerOutputDocument(CanonicalContractDocument):
    contract_name = "imageStyleAnalyzerOutput"


class OrchestrationStateDocument(CanonicalContractDocument):
    contract_name = "orchestrationState"


class ProjectRevisionConfigDocument(CanonicalContractDocument):
    contract_name = "projectRevisionConfig"


class TimelinePlanDocument(CanonicalContractDocument):
    contract_name = "timelinePlan"


class ResolvedRenderManifestDocument(CanonicalContractDocument):
    contract_name = "resolvedRenderManifest"


class ProductionManifestDocument(CanonicalContractDocument):
    contract_name = "productionManifest"


class WorkerJobEnvelopeDocument(CanonicalContractDocument):
    contract_name = "workerJobEnvelope"


class TranscriptTimingDocument(CanonicalContractDocument):
    contract_name = "transcriptTiming"


class AsrJobInputDocument(CanonicalContractDocument):
    contract_name = "asrJobInput"


class AsrJobResultDocument(CanonicalContractDocument):
    contract_name = "asrJobResult"


class RenderJobInputDocument(CanonicalContractDocument):
    contract_name = "renderJobInput"


class TechnicalProbeDocument(CanonicalContractDocument):
    contract_name = "technicalProbe"


class RenderJobResultDocument(CanonicalContractDocument):
    contract_name = "renderJobResult"


CONTRACT_MODELS: dict[ContractName, type[BaseModel]] = {
    "avatarProfileVersion": AvatarProfileVersionDocument,
    "createProjectRequest": CreateProjectRequest,
    "imageStyleProfile": ImageStyleProfileDocument,
    "imageStyleAnalyzerOutput": ImageStyleAnalyzerOutputDocument,
    "orchestrationState": OrchestrationStateDocument,
    "projectRevisionConfig": ProjectRevisionConfigDocument,
    "timelinePlan": TimelinePlanDocument,
    "resolvedRenderManifest": ResolvedRenderManifestDocument,
    "productionManifest": ProductionManifestDocument,
    "workerJobEnvelope": WorkerJobEnvelopeDocument,
    "transcriptTiming": TranscriptTimingDocument,
    "asrJobInput": AsrJobInputDocument,
    "asrJobResult": AsrJobResultDocument,
    "renderJobInput": RenderJobInputDocument,
    "technicalProbe": TechnicalProbeDocument,
    "renderJobResult": RenderJobResultDocument,
}
