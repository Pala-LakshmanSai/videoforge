import {
  sha256CanonicalJson,
  validateAndHashContractDocument,
  type JsonValue,
} from "@videoforge/contracts";

import { fixtureTimelineDocuments } from "./timeline-inspection";

export interface ProviderFreeFoundationReceipts {
  readonly transcriptSha256: string;
  readonly timelineSha256: string;
  readonly promptManifestSha256: string;
}

export async function buildProviderFreeFoundationReceipts(
  projectId: string,
): Promise<ProviderFreeFoundationReceipts> {
  const safeProjectId = projectId.replaceAll(/[^A-Za-z0-9._:-]/gu, "-");
  const revisionId = `revision_cp05_${safeProjectId}`;
  const documents = fixtureTimelineDocuments({ id: projectId, revisionId });
  const [transcript, timeline] = await Promise.all([
    validateAndHashContractDocument("transcriptTiming", documents.transcript),
    validateAndHashContractDocument("timelinePlan", documents.timeline),
  ]);
  const promptManifest = {
    schema_version: "videoforge.provider-free-prompt-fixture/v1",
    project_id: projectId,
    project_revision_id: revisionId,
    transcript_sha256: transcript.sha256,
    timeline_sha256: timeline.sha256,
    writer: "runware-deepseek-v4-flash-0731-fixture",
    provider_calls_authorized: false,
    prompts: timeline.value.segments.flatMap((segment) => {
      if (segment.timeline_composition === "AVATAR_FULL") return [];
      const slot =
        segment.timeline_composition === "IMAGE_FULL"
          ? segment.required_slots.image
          : segment.required_slots.right_image;
      return [
        {
          task_key: slot.task_key,
          shot_role: segment.in_image_shot_role,
          phrase: segment.phrase,
          hard_rules: ["no text", "no logo", "no border", "slow centered image zoom"],
        },
      ];
    }),
  } as unknown as JsonValue;
  return Object.freeze({
    transcriptSha256: transcript.sha256,
    timelineSha256: timeline.sha256,
    promptManifestSha256: await sha256CanonicalJson(promptManifest),
  });
}
