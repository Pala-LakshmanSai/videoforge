import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  V207_REPAIRED_IMAGE,
  V207_REPAIRED_IMAGE_SOURCE_COMMIT,
} from "./v207-activation-authority";

const previousV207Image = process.env.V207_IMAGE;
const previousV207SourceCommit = process.env.V207_IMAGE_SOURCE_COMMIT;
const previousV207Cap = process.env.V207_FINITE_CAP_USD;
process.env.V207_IMAGE = V207_REPAIRED_IMAGE;
process.env.V207_IMAGE_SOURCE_COMMIT = V207_REPAIRED_IMAGE_SOURCE_COMMIT;
process.env.V207_FINITE_CAP_USD = "4";
const { isAllowedV207GhcrBlobRedirect } = await import("./v207-live-qualification");
if (previousV207Image === undefined) delete process.env.V207_IMAGE;
else process.env.V207_IMAGE = previousV207Image;
if (previousV207SourceCommit === undefined) delete process.env.V207_IMAGE_SOURCE_COMMIT;
else process.env.V207_IMAGE_SOURCE_COMMIT = previousV207SourceCommit;
if (previousV207Cap === undefined) delete process.env.V207_FINITE_CAP_USD;
else process.env.V207_FINITE_CAP_USD = previousV207Cap;

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

  it("follows only the signed GHCR blob redirect without forwarding registry auth", () => {
    const digest = "sha256:" + "a".repeat(64);
    expect(
      isAllowedV207GhcrBlobRedirect(
        new URL(
          `https://pkg-containers.githubusercontent.com/ghcrblobs07/blobs/${digest}?se=2030-01-01T00%3A00%3A00Z&sig=redacted`,
        ),
        digest,
      ),
    ).toBe(true);
    expect(
      isAllowedV207GhcrBlobRedirect(
        new URL(`https://evil.example/blobs/${digest}?se=x&sig=y`),
        digest,
      ),
    ).toBe(false);
    expect(source).toContain('headers: { accept: headers.accept ?? "application/octet-stream" }');
    expect(source).toContain('redirect: "manual"');
  });

  it("has a provider-free preflight branch before template, endpoint, and R2 mutations", () => {
    expect(source).toContain('process.env.V207_PREFLIGHT_ONLY === "1"');
    expect(source).toContain("runV207PreflightOnly");
    expect(source).toContain("V207_PREFLIGHT_INVENTORY_UNEXPECTED");
    expect(source).toContain("V207_ROUTE_AUTHORITY_UNVERIFIED");
  });
});
