import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = await readFile(
  join(process.cwd(), "src/server/providers/v207-live-qualification.ts"),
  "utf8",
);

describe("V2-07 live qualification runner safety", () => {
  it("pins the repaired registry attestation and rejects the fixture artifact plane", () => {
    expect(source).toContain("V207_IMAGE_CONFIG_DIGEST_MISMATCH");
    expect(source).toContain("org.opencontainers.image.revision");
    expect(source).toContain("V207_REPAIRED_IMAGE_SOURCE_COMMIT");
    expect(source).not.toContain("FakeR2ArtifactPlane");
  });

  it("uses the full request lifetime and durable hosted finalization", () => {
    expect(source).toContain("lifetime_seconds: V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS");
    expect(source).toContain('operation: "FINALIZE"');
    expect(source).toContain('schema_version !== "artifact-commit-receipt/v3"');
    expect(source).toContain("MAGE_COMMIT_RECEIPT_REPLAY_INVALID");
  });

  it("requires one exact 32-image 1280x720 PNG batch with full receipts", () => {
    expect(source).toContain("output.items.length !== 32");
    expect(source).toContain("receiptItems.length !== objectKeys.length");
    expect(source).toContain("png.readUInt32BE(16) !== 1280");
    expect(source).toContain("png.readUInt32BE(20) !== 720");
    expect(source).toContain("MAGE_RECEIPT_IDENTITY_INVALID");
  });

  it("uses unique attempt lineage, bounded reads, and account-wide final drain proof", () => {
    expect(source).toContain("randomBytes(6)");
    expect(source).toContain("AbortSignal.timeout(30_000)");
    expect(source).toContain("finalInventory.activeServerlessWorkerCount !== 0");
    expect(source).toContain("V207_FINAL_INVENTORY_INVALID");
    expect(source).toContain("expectedVolumeHashes");
  });
});
