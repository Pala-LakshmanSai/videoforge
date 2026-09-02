from __future__ import annotations

from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, model_validator

from .validator import ContractName, validate_contract

GenerationMode = Literal["LOWEST_COST", "BALANCED", "FASTER"]


class ExecutionProfileOverrides(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    image_media_profile_id: str | None = None
    avatar_primary_profile_id: str | None = None
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
    spend_cap_usd: float = Field(ge=0.05, le=2)
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


class ArtifactObjectIdentityV3Document(CanonicalContractDocument):
    contract_name = "artifactObjectIdentityV3"


class ArtifactTransferPortV3Document(CanonicalContractDocument):
    contract_name = "artifactTransferPortV3"


class ArtifactCommitReceiptV3Document(CanonicalContractDocument):
    contract_name = "artifactCommitReceiptV3"


class ServerlessEndpointDeploymentV3Document(CanonicalContractDocument):
    contract_name = "serverlessEndpointDeploymentV3"


class ServerlessPredispatchAuthorityV3Document(CanonicalContractDocument):
    contract_name = "serverlessPredispatchAuthorityV3"


class ServerlessDispatchOutboxV3Document(CanonicalContractDocument):
    contract_name = "serverlessDispatchOutboxV3"


class ServerlessRequestAttemptV3Document(CanonicalContractDocument):
    contract_name = "serverlessRequestAttemptV3"


class ServerlessProviderAssignmentV3Document(CanonicalContractDocument):
    contract_name = "serverlessProviderAssignmentV3"


class ServerlessWorkerJobEnvelopeV3Document(CanonicalContractDocument):
    contract_name = "serverlessWorkerJobEnvelopeV3"


class ServerlessProvenanceReceiptV1Document(CanonicalContractDocument):
    contract_name = "serverlessProvenanceReceiptV1"


class ServerlessProgressEventV3Document(CanonicalContractDocument):
    contract_name = "serverlessProgressEventV3"


class ServerlessOutputReceiptV3Document(CanonicalContractDocument):
    contract_name = "serverlessOutputReceiptV3"


class ServerlessCancellationV3Document(CanonicalContractDocument):
    contract_name = "serverlessCancellationV3"


class ServerlessReconciliationV3Document(CanonicalContractDocument):
    contract_name = "serverlessReconciliationV3"


class ServerlessCostLedgerV3Document(CanonicalContractDocument):
    contract_name = "serverlessCostLedgerV3"


class GenerationAdmissionV3Document(CanonicalContractDocument):
    contract_name = "generationAdmissionV3"


class ProductionManifestV3Document(CanonicalContractDocument):
    contract_name = "productionManifestV3"


class AvatarProfileVersionDocument(CanonicalContractDocument):
    contract_name = "avatarProfileVersion"


class AdmittedIdentityDocument(CanonicalContractDocument):
    contract_name = "admittedIdentity"


class DurableTimingLineageDocument(CanonicalContractDocument):
    contract_name = "durableTimingLineage"


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


class GenerationWorkManifestDocument(CanonicalContractDocument):
    contract_name = "generationWorkManifest"


class RenderWorkManifestDocument(CanonicalContractDocument):
    contract_name = "renderWorkManifest"


class ResolvedRenderManifestDocument(CanonicalContractDocument):
    contract_name = "resolvedRenderManifest"


class ProductionManifestDocument(CanonicalContractDocument):
    contract_name = "productionManifest"


class GlobalGenerationSessionDocument(CanonicalContractDocument):
    contract_name = "globalGenerationSession"


class PodWorkerJobEnvelopeDocument(CanonicalContractDocument):
    contract_name = "podWorkerJobEnvelope"


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
    "artifactObjectIdentityV3": ArtifactObjectIdentityV3Document,
    "artifactTransferPortV3": ArtifactTransferPortV3Document,
    "artifactCommitReceiptV3": ArtifactCommitReceiptV3Document,
    "serverlessEndpointDeploymentV3": ServerlessEndpointDeploymentV3Document,
    "serverlessPredispatchAuthorityV3": ServerlessPredispatchAuthorityV3Document,
    "serverlessDispatchOutboxV3": ServerlessDispatchOutboxV3Document,
    "serverlessRequestAttemptV3": ServerlessRequestAttemptV3Document,
    "serverlessProviderAssignmentV3": ServerlessProviderAssignmentV3Document,
    "serverlessWorkerJobEnvelopeV3": ServerlessWorkerJobEnvelopeV3Document,
    "serverlessProvenanceReceiptV1": ServerlessProvenanceReceiptV1Document,
    "serverlessProgressEventV3": ServerlessProgressEventV3Document,
    "serverlessOutputReceiptV3": ServerlessOutputReceiptV3Document,
    "serverlessCancellationV3": ServerlessCancellationV3Document,
    "serverlessReconciliationV3": ServerlessReconciliationV3Document,
    "serverlessCostLedgerV3": ServerlessCostLedgerV3Document,
    "generationAdmissionV3": GenerationAdmissionV3Document,
    "productionManifestV3": ProductionManifestV3Document,
    "admittedIdentity": AdmittedIdentityDocument,
    "avatarProfileVersion": AvatarProfileVersionDocument,
    "createProjectRequest": CreateProjectRequest,
    "durableTimingLineage": DurableTimingLineageDocument,
    "globalGenerationSession": GlobalGenerationSessionDocument,
    "imageStyleProfile": ImageStyleProfileDocument,
    "imageStyleAnalyzerOutput": ImageStyleAnalyzerOutputDocument,
    "orchestrationState": OrchestrationStateDocument,
    "projectRevisionConfig": ProjectRevisionConfigDocument,
    "timelinePlan": TimelinePlanDocument,
    "generationWorkManifest": GenerationWorkManifestDocument,
    "renderWorkManifest": RenderWorkManifestDocument,
    "resolvedRenderManifest": ResolvedRenderManifestDocument,
    "productionManifest": ProductionManifestDocument,
    "podWorkerJobEnvelope": PodWorkerJobEnvelopeDocument,
    "workerJobEnvelope": WorkerJobEnvelopeDocument,
    "transcriptTiming": TranscriptTimingDocument,
    "asrJobInput": AsrJobInputDocument,
    "asrJobResult": AsrJobResultDocument,
    "renderJobInput": RenderJobInputDocument,
    "technicalProbe": TechnicalProbeDocument,
    "renderJobResult": RenderJobResultDocument,
}
