import { createHash } from "node:crypto";

import {
  buildPromptBatch,
  buildRunwarePromptRequest,
  RUNWARE_PROMPT_MODEL,
  type RunwarePromptAttemptEvidence,
} from "@videoforge/pipeline";

import { createRunwareRuntime } from "./runware-runtime";

const evidence: RunwarePromptAttemptEvidence[] = [];
const runtime = await createRunwareRuntime(
  {
    VIDEOFORGE_PROVIDER_MODE: process.env.VIDEOFORGE_PROVIDER_MODE,
    VIDEOFORGE_RUNWARE_ENABLED: process.env.VIDEOFORGE_RUNWARE_ENABLED,
    VIDEOFORGE_RUNWARE_CAP_USD: process.env.VIDEOFORGE_RUNWARE_CAP_USD,
  },
  {
    record: (item) => {
      evidence.push(item);
    },
  },
);
if (!runtime) throw new Error("RUNWARE_RUNTIME_NOT_ENABLED");

const scenes = Array.from({ length: 25 }, (_, index) => {
  const ordinal = String(index + 1).padStart(3, "0");
  return {
    sceneId: `scene_${ordinal}`,
    phrase: `A craftsperson carefully inspects wooden part ${ordinal} on a clean workshop bench.`,
    sentenceContext: `A craftsperson carefully inspects wooden part ${ordinal} on a clean workshop bench.`,
    priorContext: index === 0 ? null : "The workshop inspection continues.",
    nextContext: index === 24 ? null : "The next wooden part is inspected.",
    inImageShotRole: index % 2 === 0 ? ("HANDS_ACTION" as const) : ("OBJECT_EVIDENCE" as const),
    layout: "IMAGE_FULL" as const,
  };
});
const batch = buildPromptBatch({
  batchId: "vf_8_02_live_smoke",
  projectTitle: "Owned synthetic workshop inspection",
  imageStyleVersionId: "documentary_stock_v1",
  styleProfileHash: `sha256:${"1".repeat(64)}`,
  plannerGuidance: "Literal documentary stock photography, natural light, realistic materials.",
  storyContext: JSON.stringify({
    summary: "A craftsperson inspects wooden parts in one workshop.",
  }),
  continuityTags: ["same clean workshop", "same craftsperson"],
  scenes,
});
const transportResult = await runtime.promptTransport.dispatch(
  buildRunwarePromptRequest(batch, batch.scenes, 1),
);
if (transportResult.status !== "succeeded") {
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: "videoforge.runware-live-smoke/v1",
      model: RUNWARE_PROMPT_MODEL,
      transportResult,
      diagnostics: runtime.diagnostics,
      spend: runtime.ledger.snapshot(),
    })}\n`,
  );
  process.exitCode = 2;
} else {
  const output = await runtime.promptWriter.write(batch);
  const outputHash = `sha256:${createHash("sha256").update(JSON.stringify(output)).digest("hex")}`;
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: "videoforge.runware-live-smoke/v1",
      model: RUNWARE_PROMPT_MODEL,
      batchId: batch.batchId,
      outputSceneCount:
        typeof output === "object" &&
        output !== null &&
        "scenes" in output &&
        Array.isArray(output.scenes)
          ? output.scenes.length
          : null,
      outputHash,
      attempts: evidence,
      spend: runtime.ledger.snapshot(),
    })}\n`,
  );
}
