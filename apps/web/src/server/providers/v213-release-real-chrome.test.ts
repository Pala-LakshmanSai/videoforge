import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  buildV213ReleaseChromeRequest,
  produceV213ReleaseChromeAcceptance,
  validateV213ReleaseChromeRequest,
  V213_RELEASE_CHROME_CHILD_RECEIPT_SCHEMA,
  V213_RELEASE_CHROME_OBSERVATION_SCHEMA,
  type SpawnV213ReleaseChromeJourney,
  type V213ReleaseChromeChildReceipt,
  type V213ReleaseChromeObservation,
  type V213ReleaseChromeRequest,
  type V213VerifiedPersistedSmokeTerminal,
  type V213VerifiedReleaseChromeChildReceipt,
} from "./v213-release-real-chrome.js";

const NOW = new Date("2026-08-28T00:05:00.000Z");
const HASHES = Object.freeze({
  smoke: `sha256:${"1".repeat(64)}` as Sha256,
  release: `sha256:${"2".repeat(64)}` as Sha256,
  url: `sha256:${"3".repeat(64)}` as Sha256,
  output: `sha256:${"4".repeat(64)}` as Sha256,
  receipt: `sha256:${"5".repeat(64)}` as Sha256,
  signature: `sha256:${"6".repeat(64)}` as Sha256,
});

function request(overrides: Partial<V213ReleaseChromeRequest> = {}): V213ReleaseChromeRequest {
  const valid = buildV213ReleaseChromeRequest(
    {
      fullLiveAuthorityId: "123e4567-e89b-42d3-a456-426614174000",
      smokeEvidenceSha256: HASHES.smoke,
      releaseIdentitySha256: HASHES.release,
      productionUrlSha256: HASHES.url,
      accountId: "account-release",
      workspaceId: "workspace-release",
      projectId: "project-release",
      projectRevisionId: "revision-release",
      outputSha256: HASHES.output,
      finalOutputReceiptSha256: HASHES.receipt,
      attemptId: "attempt-release",
      smokeTerminalAt: "2026-08-28T00:00:00.000Z",
      deadlineAt: "2026-08-28T00:10:00.000Z",
    },
    NOW,
  );
  if (Object.keys(overrides).length === 0) return valid;
  const changed = { ...valid, ...overrides };
  const { requestSha256: _old, ...unsigned } = changed;
  void _old;
  return { ...changed, requestSha256: canonicalSha256(unsigned) };
}

function observation(
  value: V213ReleaseChromeRequest,
  overrides: Partial<V213ReleaseChromeObservation> = {},
): V213ReleaseChromeObservation {
  return {
    schemaVersion: V213_RELEASE_CHROME_OBSERVATION_SCHEMA,
    requestSha256: value.requestSha256,
    fullLiveAuthorityId: value.fullLiveAuthorityId,
    smokeEvidenceSha256: value.smokeEvidenceSha256,
    releaseIdentitySha256: value.releaseIdentitySha256,
    productionUrlSha256: value.productionUrlSha256,
    accountId: value.accountId,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    projectRevisionId: value.projectRevisionId,
    outputSha256: value.outputSha256,
    finalOutputReceiptSha256: value.finalOutputReceiptSha256,
    attemptId: value.attemptId,
    browser: "GOOGLE_CHROME",
    fixtureOrFakeTransportUsed: false,
    playbackPassed: true,
    privateProjectReadbackPassed: true,
    privateRevisionReadbackPassed: true,
    downloadPassed: true,
    downloadedOutputSha256: value.outputSha256,
    observedAt: NOW.toISOString(),
    ...overrides,
  };
}

function receipt(
  value: V213ReleaseChromeRequest,
  overrides: Partial<V213ReleaseChromeObservation> = {},
): V213ReleaseChromeChildReceipt {
  const document = observation(value, overrides);
  return {
    schemaVersion: V213_RELEASE_CHROME_CHILD_RECEIPT_SCHEMA,
    requestSha256: value.requestSha256,
    observationSha256: canonicalSha256(document),
    keyId: "release-chrome-child-key",
    signatureHex: "a".repeat(64),
    document,
  };
}

function verified(value: V213ReleaseChromeChildReceipt): V213VerifiedReleaseChromeChildReceipt {
  return {
    verifierId: "videoforge-v213-release-chrome-child-receipt-verifier-v1",
    accepted: true,
    canonicalReceiptSha256: canonicalSha256(value),
    signatureSha256: HASHES.signature,
    signatureVerified: true,
  };
}

function verifiedSmoke(value: V213ReleaseChromeRequest): V213VerifiedPersistedSmokeTerminal {
  return {
    verifierId: "videoforge-v213-persisted-smoke-terminal-verifier-v1",
    accepted: true,
    canonicalEvidenceSha256: canonicalSha256({
      artifactSha256: value.smokeEvidenceSha256,
    }),
    signatureVerified: true,
    fullLiveAuthorityId: value.fullLiveAuthorityId,
    smokeEvidenceSha256: value.smokeEvidenceSha256,
    smokeTerminalAt: value.smokeTerminalAt,
  };
}

async function produce(
  requestValue: V213ReleaseChromeRequest,
  receiptValue: V213ReleaseChromeChildReceipt,
  verifiedValue: V213VerifiedReleaseChromeChildReceipt = verified(receiptValue),
) {
  const kill = vi.fn();
  const spawnJourney: SpawnV213ReleaseChromeJourney = vi.fn(() => ({
    receipt: Promise.resolve(receiptValue),
    kill,
  }));
  const result = await produceV213ReleaseChromeAcceptance({
    request: requestValue,
    childSigningKeyFd: 3,
    spawnJourney,
    verifyPersistedSmokeTerminal: vi.fn(async () => verifiedSmoke(requestValue)),
    verifyChildReceipt: vi.fn(async () => verifiedValue),
    now: () => NOW,
  });
  return { result, spawnJourney, kill };
}

describe("V2-13 release-bound real Chrome producer", () => {
  it("builds an exact canonical request and rejects a V2-09 request schema", () => {
    const value = request();
    expect(validateV213ReleaseChromeRequest(value, NOW)).toEqual(value);
    expect(() =>
      validateV213ReleaseChromeRequest(
        {
          ...value,
          schemaVersion: "videoforge.v2-09-real-chrome-request/v1",
        },
        NOW,
      ),
    ).toThrowError("V213_RELEASE_CHROME_REQUEST_SCHEMA_INVALID");
  });

  it("rejects absent, future, and stale smoke before starting Chrome", () => {
    const value = request();
    const { smokeEvidenceSha256: _missing, ...withoutSmoke } = value;
    void _missing;
    expect(() => validateV213ReleaseChromeRequest(withoutSmoke, NOW)).toThrowError(
      "V213_RELEASE_CHROME_REQUEST_FIELDS_INVALID",
    );
    expect(() =>
      validateV213ReleaseChromeRequest(
        request({ smokeTerminalAt: "2026-08-28T00:05:00.001Z" }),
        NOW,
      ),
    ).toThrowError("V213_RELEASE_CHROME_SMOKE_FROM_FUTURE");
    expect(() =>
      validateV213ReleaseChromeRequest(
        request({
          smokeTerminalAt: "2026-08-27T23:49:59.999Z",
          deadlineAt: "2026-08-28T00:05:01.000Z",
        }),
        NOW,
      ),
    ).toThrowError("V213_RELEASE_CHROME_SMOKE_STALE");
  });

  it("rejects a smoke reference that is not the exact persisted terminal", async () => {
    const value = request();
    const spawnJourney = vi.fn();
    await expect(
      produceV213ReleaseChromeAcceptance({
        request: value,
        childSigningKeyFd: 3,
        spawnJourney,
        verifyPersistedSmokeTerminal: async () => ({
          ...verifiedSmoke(value),
          smokeEvidenceSha256: `sha256:${"7".repeat(64)}`,
        }),
        verifyChildReceipt: async (child) => verified(child),
        now: () => NOW,
      }),
    ).rejects.toThrowError("V213_RELEASE_CHROME_SMOKE_TERMINAL_INVALID");
    expect(spawnJourney).not.toHaveBeenCalled();
  });

  it("rejects expired and smoke-unbounded absolute deadlines", () => {
    expect(() =>
      validateV213ReleaseChromeRequest(request({ deadlineAt: "2026-08-28T00:05:00.000Z" }), NOW),
    ).toThrowError("V213_RELEASE_CHROME_DEADLINE_EXPIRED");
    expect(() =>
      validateV213ReleaseChromeRequest(request({ deadlineAt: "2026-08-28T00:15:00.001Z" }), NOW),
    ).toThrowError("V213_RELEASE_CHROME_DEADLINE_UNBOUNDED");
  });

  it.each([
    ["authority", { fullLiveAuthorityId: "223e4567-e89b-42d3-a456-426614174000" }],
    ["smoke", { smokeEvidenceSha256: `sha256:${"7".repeat(64)}` as Sha256 }],
    ["release", { releaseIdentitySha256: `sha256:${"7".repeat(64)}` as Sha256 }],
    ["origin", { productionUrlSha256: `sha256:${"7".repeat(64)}` as Sha256 }],
    ["account", { accountId: "foreign-account" }],
    ["workspace", { workspaceId: "foreign-workspace" }],
    ["project", { projectId: "foreign-project" }],
    ["revision", { projectRevisionId: "foreign-revision" }],
    ["output", { outputSha256: `sha256:${"7".repeat(64)}` as Sha256 }],
    ["receipt", { finalOutputReceiptSha256: null }],
    ["attempt", { attemptId: "foreign-attempt" }],
  ])("rejects %s drift in the child observation", async (_label, drift) => {
    const value = request();
    await expect(produce(value, receipt(value, drift))).rejects.toThrowError(
      "V213_RELEASE_CHROME_OBSERVATION_IDENTITY_DRIFT",
    );
  });

  it.each([
    ["wrong browser", { browser: "CHROMIUM" }],
    ["fixture", { fixtureOrFakeTransportUsed: true }],
  ])("rejects %s", async (_label, invalid) => {
    const value = request();
    await expect(
      produce(value, receipt(value, invalid as unknown as Partial<V213ReleaseChromeObservation>)),
    ).rejects.toThrowError("V213_RELEASE_CHROME_BROWSER_INVALID");
  });

  it.each([
    ["playback", { playbackPassed: false }],
    ["private project", { privateProjectReadbackPassed: false }],
    ["private revision", { privateRevisionReadbackPassed: false }],
  ])("rejects failed %s proof", async (_label, invalid) => {
    const value = request();
    await expect(
      produce(value, receipt(value, invalid as unknown as Partial<V213ReleaseChromeObservation>)),
    ).rejects.toThrowError("V213_RELEASE_CHROME_PRIVATE_PLAYBACK_INVALID");
  });

  it.each([
    ["download flag", { downloadPassed: false }],
    ["download hash", { downloadedOutputSha256: `sha256:${"7".repeat(64)}` }],
  ])("rejects failed %s proof", async (_label, invalid) => {
    const value = request();
    await expect(
      produce(value, receipt(value, invalid as unknown as Partial<V213ReleaseChromeObservation>)),
    ).rejects.toThrowError("V213_RELEASE_CHROME_DOWNLOAD_INVALID");
  });

  it.each([
    ["before smoke", "2026-08-27T23:59:59.999Z"],
    ["future", "2026-08-28T00:05:00.001Z"],
    ["deadline", "2026-08-28T00:10:00.000Z"],
  ])("rejects an observation %s", async (_label, observedAt) => {
    const value = request();
    await expect(produce(value, receipt(value, { observedAt }))).rejects.toThrowError(
      "V213_RELEASE_CHROME_OBSERVED_TIME_INVALID",
    );
  });

  it("rejects circular/default document hashes and unverified child signatures", async () => {
    const value = request();
    const child = receipt(value);
    await expect(
      produce(value, {
        ...child,
        document: {
          ...child.document,
          canonicalEvidenceSha256: canonicalSha256(child.document),
        } as unknown as V213ReleaseChromeObservation,
        observationSha256: canonicalSha256({
          ...child.document,
          canonicalEvidenceSha256: canonicalSha256(child.document),
        }),
      }),
    ).rejects.toThrowError("V213_RELEASE_CHROME_OBSERVATION_FIELDS_INVALID");
    await expect(
      produce(value, child, {
        ...verified(child),
        signatureVerified: false,
      } as unknown as V213VerifiedReleaseChromeChildReceipt),
    ).rejects.toThrowError("V213_RELEASE_CHROME_CHILD_SIGNATURE_INVALID");
  });

  it("produces an exact non-circular opaque artifact and deterministic replay", async () => {
    const value = request();
    const child = receipt(value);
    const first = (await produce(value, child)).result;
    const second = (await produce(value, child)).result;
    expect(first).toEqual(second);
    expect(first.document.canonicalEvidenceSha256).toBe(
      canonicalSha256({ artifactSha256: first.artifact.artifactSha256 }),
    );
    expect(first.document.canonicalEvidenceSha256).not.toBe(canonicalSha256(first.document));
    expect(first.document).toMatchObject({
      verifierId: "videoforge-v213-real-chrome-acceptance-verifier-v1",
      browser: "GOOGLE_CHROME",
      fixtureOrFakeTransportUsed: false,
      playbackPassed: true,
      privateReadbackPassed: true,
      verifierSignatureSha256: HASHES.signature,
    });
  });

  it("passes the private key only as an FD and returns no secret-bearing fields", async () => {
    const value = request();
    const child = receipt(value);
    const { result, spawnJourney } = await produce(value, child);
    expect(spawnJourney).toHaveBeenCalledWith(
      expect.objectContaining({
        childSigningKeyFd: 3,
        deadlineAt: value.deadlineAt,
        signal: expect.any(AbortSignal),
      }),
    );
    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toMatch(/secret|privatekey|signingkey|signaturehex|keyid|fd/iu);
  });

  it("kills the journey on cancellation", async () => {
    const value = request();
    const abort = new AbortController();
    const kill = vi.fn();
    const pending = new Promise<V213ReleaseChromeChildReceipt>(() => undefined);
    const spawnJourney = vi.fn(() => ({ receipt: pending, kill }));
    const operation = produceV213ReleaseChromeAcceptance({
      request: value,
      childSigningKeyFd: 3,
      spawnJourney,
      verifyPersistedSmokeTerminal: async () => verifiedSmoke(value),
      verifyChildReceipt: async (child) => verified(child),
      now: () => NOW,
      signal: abort.signal,
    });
    await vi.waitFor(() => expect(spawnJourney).toHaveBeenCalledOnce());
    abort.abort();
    await expect(operation).rejects.toThrowError("V213_RELEASE_CHROME_CANCELLED");
    expect(kill).toHaveBeenCalledWith("SIGKILL");
  });
});
