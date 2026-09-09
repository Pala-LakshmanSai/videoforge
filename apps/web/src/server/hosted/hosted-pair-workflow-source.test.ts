import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "worker/hosted-pair-workflow.ts"), "utf8");

describe("hosted pair Workflow module loading", () => {
  it("uses only statically loaded modules after entering the ordinary pair path", () => {
    const ordinaryPath = source.slice(source.indexOf("const params = pair!;"));

    expect(ordinaryPath).not.toContain("await import(");
    expect(source).toContain("createHostedPairLiveComposition,");
    expect(source).toContain("resumeHostedV209OrdinaryPair,");
    expect(source).toContain("import { createHostedV209RenderHandoff }");
    expect(source).toContain("import { hasHostedV209OrdinaryDispatchCandidate }");
    expect(source).toContain("import { scheduleHostedRenderSubmission }");
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
});
