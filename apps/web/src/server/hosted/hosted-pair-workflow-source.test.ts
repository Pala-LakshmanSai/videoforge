import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "worker/hosted-pair-workflow.ts"), "utf8");
const liveWiringSource = readFileSync(
  resolve(process.cwd(), "src/server/hosted/hosted-pair-live-wiring.ts"),
  "utf8",
);
const runtimeStoreSource = readFileSync(
  resolve(process.cwd(), "src/server/hosted/hosted-pair-runtime-executor.ts"),
  "utf8",
);

describe("hosted pair Workflow module loading", () => {
  it("uses only statically loaded modules after entering the ordinary pair path", () => {
    const ordinaryPath = source.slice(source.indexOf("const params = pair!;"));

    expect(ordinaryPath).not.toContain("await import(");
    expect(source).toContain("createHostedPairLiveComposition,");
    expect(source).toContain("resumeHostedV209OrdinaryPair,");
    expect(source).toContain("import { createHostedV209RenderHandoff }");
    expect(source).toContain("import { hasHostedV209OrdinaryDispatchCandidate }");
    expect(source).toContain("import { scheduleHostedRenderSubmission }");
    expect(liveWiringSource).toContain("createHostedV209TerminalOutputIngestor,");
    expect(liveWiringSource).toContain("HostedSqlFunctionV209TerminalOutputStore,");
    expect(liveWiringSource).not.toContain(
      'await import("./hosted-v209-terminal-output-ingestor")',
    );
    expect(ordinaryPath).toContain('event: "OBSERVATION_STEP_STARTED"');
    expect(ordinaryPath).toContain('event: "COMPOSITION_READY"');
    expect(ordinaryPath).toContain('event: "ORDINARY_RESUME_STARTING"');
    expect(ordinaryPath).toContain(
      "closePoolsWithoutBlockingWorkflow(runtimePool, reconcilerPool)",
    );
    expect(source).toContain("Promise.race([");
  });

  it("keeps acceptance-only modules behind the acceptance branch", () => {
    const acceptancePath = source.slice(
      source.indexOf("const acceptanceCandidate"),
      source.indexOf("const params = pair!;"),
    );

    expect(acceptancePath).toContain(
      'import("../src/server/hosted/v213-acceptance-workflow-production")',
    );
    expect(acceptancePath).toContain(
      'import("../src/server/hosted/v213-acceptance-workflow-runner")',
    );
  });

  it("accepts database UUID account lineage while preserving strict generation UUIDs", () => {
    expect(source).toContain(
      "![ordinary.accountId, ordinary.workspaceId].every((item) => DATABASE_UUID.test(item))",
    );
    expect(source).toContain("!UUID.test(ordinary.generationRequestId)");
    expect(source).not.toContain(
      "![ordinary.accountId, ordinary.workspaceId, ordinary.generationRequestId].every",
    );
  });

  it("routes definite rejection cleanup before resume and preserves safe preflight retry", () => {
    expect(source).toContain("row.attemptState === \"PERMANENT_FAILED\"");
    expect(source).toContain("row.outboxState === \"DEAD_LETTER\"");
    expect(source).toContain("row.attemptState === \"OUTBOXED\"");
    expect(source).toContain("row.outboxState === \"READY_TO_DISPATCH\"");
    expect(source).toContain('row.pairPhase === "CLEANUP_ONLY"');
    expect(source.indexOf("isHostedV209CleanupOnlyRecovery(inspection)")).toBeLessThan(
      source.indexOf('event: "ORDINARY_RESUME_STARTING"'),
    );
    expect(source).toContain("isHostedV209SafelyUnsent(afterFailure)");
    expect(source).toContain("SENT/unknown acknowledgement");
  });

  it("allows only the exact pre-begin fresh pair to reach the first resume", () => {
    expect(source).toContain("async function inspectInitializedHostedPair(");
    expect(source).toContain("return inspection.length === 0 ? null : inspection;");
    expect(runtimeStoreSource).toContain("result.rows.length === 0");
    expect(source).toContain("if (inspection && isHostedV209CleanupOnlyRecovery(inspection))");
    expect(source).toContain(
      "if (afterFailure === null || isHostedV209SafelyUnsent(afterFailure)) throw error;",
    );
  });

  it("takes one final provider observation before failing closed at the stop deadline", () => {
    expect(source).toContain("const pastStopDeadline = Date.parse(clock) >= Date.parse(params.stopAt);");
    expect(source).toContain("const observationResult = await live.reconciler.observe(");
    expect(source).toContain(
      'if (pastStopDeadline && observationResult.state !== "SETTLED")',
    );
  });

  it("does not let expired paid approval block reconciliation of an assigned pair", () => {
    expect(source).toContain('event: "ASSIGNED_PAIR_RECONCILIATION_STARTING"');
    expect(source).toContain('row.recoveryAction === "RECONCILE_ASSIGNED"');
    expect(source.indexOf('event: "ASSIGNED_PAIR_RECONCILIATION_STARTING"')).toBeLessThan(
      source.indexOf("const gate = await live.composition.gate"),
    );
  });
});
