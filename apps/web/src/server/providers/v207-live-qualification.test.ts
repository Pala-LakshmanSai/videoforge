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
const {
  assertV207ItemCount,
  createV207Cancellation,
  installV207SignalHandlers,
  isAllowedV207GhcrBlobRedirect,
  redactV207LiveEvidence,
} = await import("./v207-live-qualification");
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
    expect(source).toContain("assertV207ItemCount(itemCount)");
    expect(source).toContain("output.items.length !== itemCount");
    expect(source).toContain("receiptItems.length !== objectKeys.length");
    expect(source).toContain("png.readUInt32BE(16) !== 1280");
    expect(source).toContain("png.readUInt32BE(20) !== 720");
    expect(source).toContain("MAGE_RECEIPT_IDENTITY_INVALID");
  });

  it("narrows the sealed worker's remote contract to one exact 32-item video batch", () => {
    for (const itemCount of [0, 1, 16, 31, 33, 64, 65]) {
      expect(() => assertV207ItemCount(itemCount)).toThrow("V207_BATCH_ITEM_COUNT_INVALID");
    }
    expect(() => assertV207ItemCount(1.5)).toThrow("V207_BATCH_ITEM_COUNT_INVALID");
    expect(() => assertV207ItemCount(32)).not.toThrow();
    expect(source).toContain("QUALIFICATION_SCENES.slice(0, itemCount)");
    expect(source).toContain("item_count: itemCount");
    expect(source).toContain("MAGE_OUTPUT_NOT_SUCCEEDED:${outputStatus}:${failureCode}");
  });

  it("regresses Attempt 10 by making the owned probe a complete 32-item batch", () => {
    const liveBatchCounts = [
      ...source.matchAll(
        /(?:probe|cold|warm|readerA|readerB|cancel) = await createBatch\([\s\S]*?workerToken,\s+(\d+),/g,
      ),
    ].map((match) => match[1]);
    expect(liveBatchCounts).toEqual(["32", "32", "32", "32", "32", "32"]);
    expect(source).toContain('kind: "owned_probe"');
    expect(source).not.toContain("workerToken,\n        1,");
    expect(() => assertV207ItemCount(31)).toThrow("V207_BATCH_ITEM_COUNT_INVALID");
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

  it("mounts the sealed volume at its fixed path and reads the CP-06 model subdirectory", () => {
    expect(source).toContain("V207_RUNPOD_VOLUME_MOUNT");
    expect(source).toContain("MAGE_MODEL_ROOT: V207_RUNPOD_MODEL_ROOT");
    expect(source).not.toContain("MAGE_MODEL_ROOT: V207_RUNPOD_VOLUME_MOUNT");
  });

  it("keeps cancellation inside bounded cleanup and removes signal handlers", () => {
    const cancellation = createV207Cancellation();
    const listeners = new Map<string, () => void>();
    const target = {
      on(signal: string, handler: () => void): void {
        listeners.set(signal, handler);
      },
      off(signal: string, handler: () => void): void {
        if (listeners.get(signal) === handler) listeners.delete(signal);
      },
    } as never;
    const remove = installV207SignalHandlers(cancellation, target);
    expect(listeners.has("SIGINT")).toBe(true);
    expect(listeners.has("SIGTERM")).toBe(true);
    listeners.get("SIGTERM")?.();
    expect(cancellation.requested).toBe(true);
    expect(() => cancellation.throwIfRequested()).toThrow("V207_QUALIFICATION_CANCELLED");
    remove();
    expect(listeners.size).toBe(0);
    expect(source).toContain("abortCheck: cancellation.throwIfRequested");
    expect(source).toContain("await harness.cleanup({ deleteIfFailed: true, failed: true })");
    expect(source).toContain('const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"]');
  });

  it("persists only redacted checkpoint evidence with no raw provider material", () => {
    const hash = "sha256:" + "a".repeat(64);
    const redacted = redactV207LiveEvidence({
      run_tag: "20260820-abcdef012345",
      endpoint_id: "endpoint-raw",
      job_id: "job-raw",
      reservation_id: "reservation-raw",
      nonce: "nonce-raw",
      token: "token-raw",
      url: "https://signed.example/private?sig=secret",
      endpoint_id_hash: hash,
      endpointIdHash: hash,
      manifest_sha256: hash,
      volume_id_hashes: [hash],
      volume_regions: ["EU-RO-1"],
      started_at: "2026-08-20T12:30:00.000Z",
      os: "linux",
      architecture: "amd64",
      status: "COMPLETED",
    });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("endpoint-raw");
    expect(serialized).not.toContain("job-raw");
    expect(serialized).not.toContain("reservation-raw");
    expect(serialized).not.toContain("nonce-raw");
    expect(serialized).not.toContain("token-raw");
    expect(serialized).not.toContain("signed.example");
    expect(redacted.run_tag).toBe("20260820-abcdef012345");
    expect(redacted.endpoint_id_hash).toBe(hash);
    expect(redacted.endpointIdHash).toBe(hash);
    expect(redacted.manifest_sha256).toBe(hash);
    expect(redacted.volume_id_hashes).toEqual([hash]);
    expect(redacted.volume_regions).toEqual(["EU-RO-1"]);
    expect(redacted.started_at).toBe("2026-08-20T12:30:00.000Z");
    expect(redacted.os).toBe("linux");
    expect(redacted.architecture).toBe("amd64");
    expect(redacted.status).toBe("COMPLETED");
    expect(source).toContain("if (SAFE_PROVIDER_CODE.test(candidate)) return candidate");
    expect(source).toContain("writeV207EvidenceCheckpoint");
    expect(source).toContain("mode: 0o600");
    expect(source).toContain('await persistCheckpoint("initialized")');
    expect(source).toContain('await persistCheckpoint("create")');
    expect(source).toContain('event: "provider_status"');
  });
});
