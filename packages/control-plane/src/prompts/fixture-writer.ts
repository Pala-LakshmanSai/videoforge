import { canonicalizeJson } from "@videoforge/contracts";
import {
  DeterministicFixturePromptWriter,
  validatePromptWriterOutput,
  type PromptBatch,
} from "@videoforge/pipeline";

import { hashUtf8 } from "./hashes.js";
import type { DurablePromptWriterPort, DurablePromptWriterResult } from "./types.js";

/** Default zero-network, zero-cost durable prompt writer seam. */
export class DurableFixturePromptWriter implements DurablePromptWriterPort {
  public readonly operation = "fixture.write" as const;
  private readonly writer = new DeterministicFixturePromptWriter();

  public async write(batch: PromptBatch): Promise<DurablePromptWriterResult> {
    const output = validatePromptWriterOutput(batch, await this.writer.write(batch));
    const requestBytes = canonicalizeJson(batch);
    const responseBytes = canonicalizeJson(output);
    const sceneIds = Object.freeze(batch.scenes.map((scene) => scene.sceneId));
    return Object.freeze({
      output,
      attempts: Object.freeze([
        Object.freeze({
          attemptIndex: 1,
          requestedSceneIds: sceneIds,
          requestBytes,
          requestHash: hashUtf8(requestBytes),
          responseBytes,
          responseHash: hashUtf8(responseBytes),
          retryOfRequestHash: null,
          acceptedSceneIds: sceneIds,
          unresolvedSceneIds: Object.freeze([]),
          inputTokens: 0,
          outputTokens: 0,
          reportedCostMicroUsd: 0,
        }),
      ]),
    });
  }
}
