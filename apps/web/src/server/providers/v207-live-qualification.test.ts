import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { hashV207PlanManifest } from "./runpod-v207-qualification-harness";

import {
  V207_PENDING_PROPOSAL_SHA256,
  V207_REPAIRED_IMAGE,
  V207_REPAIRED_IMAGE_SOURCE_COMMIT,
} from "./v207-activation-authority";

const previousV207Image = process.env.V207_IMAGE;
const previousV207SourceCommit = process.env.V207_IMAGE_SOURCE_COMMIT;
const previousV207Proposal = process.env.V207_PROPOSAL_SHA256;
const previousV207Cap = process.env.V207_FINITE_CAP_USD;
process.env.V207_IMAGE = V207_REPAIRED_IMAGE;
process.env.V207_IMAGE_SOURCE_COMMIT = V207_REPAIRED_IMAGE_SOURCE_COMMIT;
process.env.V207_PROPOSAL_SHA256 = V207_PENDING_PROPOSAL_SHA256;
process.env.V207_FINITE_CAP_USD = "4";
const {
  assertV207ItemCount,
  assertV207FreshCatalogOffering,
  buildV207TemplateEnvironment,
  createV207Cancellation,
  deleteV207GeneratedObject,
  deleteV207GeneratedObjects,
  extractV207EndpointReadbackMismatchCategory,
  extractV207OutputContractDiagnostics,
  extractV207ProviderJobErrorCode,
  installV207SignalHandlers,
  isAllowedV207GhcrBlobRedirect,
  mergeV207AcceptedUnits,
  readV207EndpointBillingAmount,
  readV207OutputReadback,
  redactV207LiveEvidence,
  redactV207ProviderJobError,
  routePort,
  V207_SECURE_REFERENCE_RATE_USD_PER_HOUR,
  V207_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR,
  V207GeneratedOutputRollbackError,
  V207OutputContractError,
} = await import("./v207-live-qualification");
const { RunPodControlError } = await import("./runpod-control");
if (previousV207Image === undefined) delete process.env.V207_IMAGE;
else process.env.V207_IMAGE = previousV207Image;
if (previousV207SourceCommit === undefined) delete process.env.V207_IMAGE_SOURCE_COMMIT;
else process.env.V207_IMAGE_SOURCE_COMMIT = previousV207SourceCommit;
if (previousV207Proposal === undefined) delete process.env.V207_PROPOSAL_SHA256;
else process.env.V207_PROPOSAL_SHA256 = previousV207Proposal;
if (previousV207Cap === undefined) delete process.env.V207_FINITE_CAP_USD;
else process.env.V207_FINITE_CAP_USD = previousV207Cap;

const source = await readFile(
  join(process.cwd(), "src/server/providers/v207-live-qualification.ts"),
  "utf8",
);
type TestRecord = Record<string, unknown>;

describe("V2-07 live qualification runner safety", () => {
  it("injects the exact envelope verifier material paired to the dispatch signer", () => {
    const workerToken = "cd".repeat(32);
    const environment = buildV207TemplateEnvironment(
      workerToken,
      "receipt-key-v1",
      Buffer.from("ab".repeat(32), "hex"),
    );
    expect(environment).toMatchObject({
      VIDEOFORGE_MAGE_WORKER_TOKEN: workerToken,
      VIDEOFORGE_ENVELOPE_KEY_ID: "worker-key-1",
      VIDEOFORGE_ENVELOPE_KEY_SHA256:
        "sha256:7969ec0fcb8b648dfde24b1d0ae24568d398dcc3a83b80a850f973238cdfd3d9",
      VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: workerToken,
      VIDEOFORGE_RECEIPT_KEY_ID: "receipt-key-v1",
      VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: "ab".repeat(32),
    });
    expect(() => buildV207TemplateEnvironment("bad", "receipt-key-v1", Buffer.alloc(32))).toThrow(
      "V207_TEMPLATE_SECRET_INVALID",
    );
  });

  it("retries transient billing transport and server failures before accepting a cap snapshot", async () => {
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("transient transport"))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ amount: 1.25 }, { amount: 2.25 }]), { status: 200 }),
      );

    await expect(
      readV207EndpointBillingAmount("test-api-key", {
        fetchImpl,
        sleepImpl: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).resolves.toBe(3.5);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([250, 1_000]);
    expect(fetchImpl.mock.calls[2]?.[1]?.headers).toMatchObject({ connection: "close" });
  });

  it("fails with a named ambiguous billing error after the bounded retry window", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(
      readV207EndpointBillingAmount("test-api-key", {
        fetchImpl,
        sleepImpl: async () => undefined,
      }),
    ).rejects.toThrow("RUNPOD_ENDPOINT_BILLING_READ_AMBIGUOUS");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("replays exact-key DELETE after lost success and transient service responses", async () => {
    const sleeps: number[] = [];
    let remotelyDeleted = false;
    let attempts = 0;
    const fetchImpl: typeof fetch = async () => {
      attempts += 1;
      if (attempts === 1) {
        remotelyDeleted = true;
        throw new Error("success response lost after delete");
      }
      if (attempts === 2) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => {
            throw new Error("success body lost after delete");
          },
        } as unknown as Response;
      }
      if (attempts === 3) return new Response("temporarily unavailable", { status: 503 });
      return new Response(
        JSON.stringify({
          schema_version: "videoforge-v207-generated-output-delete/v1",
          deleted: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    await expect(
      deleteV207GeneratedObject("exact-object", "b".repeat(64), {
        fetchImpl,
        sleepImpl: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).resolves.toBeUndefined();
    expect(remotelyDeleted).toBe(true);
    expect(attempts).toBe(4);
    expect(sleeps).toEqual([250, 1_000, 2_000]);
  });

  it.each([429, 500, 502, 503])("retries transient DELETE HTTP %s only", async (status) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("transient", { status }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            schema_version: "videoforge-v207-generated-output-delete/v1",
            deleted: true,
          }),
          { status: 200 },
        ),
      );
    await expect(
      deleteV207GeneratedObject("exact-object", "b".repeat(64), {
        fetchImpl,
        sleepImpl: async () => undefined,
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry rejected or malformed DELETE responses", async () => {
    for (const response of [
      new Response(JSON.stringify({ error: { code: "V207_REQUEST_INVALID" } }), {
        status: 400,
      }),
      new Response(JSON.stringify({ error: { code: "V207_AUTHORITY_REJECTED" } }), {
        status: 403,
      }),
      new Response("not-json", { status: 200 }),
      new Response(JSON.stringify({ deleted: true }), { status: 200 }),
    ]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        deleteV207GeneratedObject("exact-object", "b".repeat(64), {
          fetchImpl,
          sleepImpl: async () => undefined,
        }),
      ).rejects.toThrow(
        response.status === 400
          ? "V207_OUTPUT_DELETE_400"
          : response.status === 403
            ? "V207_OUTPUT_DELETE_403"
            : "V207_OUTPUT_DELETE_RESPONSE_INVALID",
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("attempts every rollback key and reports only bounded counts", async () => {
    const attempted: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as TestRecord;
      attempted.push(String(body.object_key));
      if (body.object_key === "key-a") {
        return new Response(JSON.stringify({ error: { code: "V207_AUTHORITY_REJECTED" } }), {
          status: 403,
        });
      }
      return new Response(
        JSON.stringify({
          schema_version: "videoforge-v207-generated-output-delete/v1",
          deleted: true,
        }),
        { status: 200 },
      );
    };
    let thrown: unknown;
    try {
      await deleteV207GeneratedObjects(["key-b", "key-a", "key-b"], "b".repeat(64), {
        fetchImpl,
        sleepImpl: async () => undefined,
      });
    } catch (error) {
      thrown = error;
    }
    expect(attempted).toEqual(["key-a", "key-b"]);
    expect(thrown).toBeInstanceOf(V207GeneratedOutputRollbackError);
    expect(
      (
        thrown as {
          summary: {
            objectKeyCount: number;
            confirmedObjectKeyCount: number;
            failedObjectKeyCount: number;
          };
        }
      ).summary,
    ).toEqual({
      objectKeyCount: 2,
      confirmedObjectKeyCount: 1,
      failedObjectKeyCount: 1,
    });
    expect(JSON.stringify(thrown)).not.toContain("key-a");
    expect(JSON.stringify(thrown)).not.toContain("key-b");
  });

  it("merges one durable seed with exactly 31 replacement units and rejects gaps", () => {
    const items = Array.from({ length: 32 }, (_, index) => ({
      scene_id: `scene-${String(index + 1).padStart(2, "0")}`,
    }));
    const plan = {
      schema_version: "videoforge-v207-plan-manifest/v1",
      tenant: { account_id: "account-a", workspace_id: "workspace-a" },
      project_id: "project-a",
      revision_id: "revision-a",
      lane: "mage-image",
      model_revision: "model-a",
      items,
    };
    const planHash = `sha256:${"a".repeat(64)}`;
    const units = items.map((item) => ({
      item_id: item.scene_id,
      plan_manifest: plan,
      plan_manifest_sha256: planHash,
    }));
    // The merge recomputes the plan hash, so align the records with the exact helper output.
    const exactHash = hashV207PlanManifest(plan);
    for (const unit of units) unit.plan_manifest_sha256 = exactHash;
    expect(
      mergeV207AcceptedUnits(units.slice(0, 1) as any, units.slice(1) as any, plan),
    ).toHaveLength(32);
    expect(() =>
      mergeV207AcceptedUnits(units.slice(0, 1) as any, units.slice(2) as any, plan),
    ).toThrow("V207_RESUME_DURABLE_UNIT_INCOMPLETE");
  });
  it("pins the repaired registry attestation and rejects the fixture artifact plane", () => {
    expect(source).toContain("V207_IMAGE_CONFIG_DIGEST_MISMATCH");
    expect(source).toContain("V207_IMAGE_LAYER_DIGEST_MISMATCH");
    expect(source).toContain("V207_REPAIRED_IMAGE_CONFIG_DIGEST");
    expect(source).toContain("V207_REPAIRED_IMAGE_LAYER_DIGEST");
    expect(source).toContain("org.opencontainers.image.revision");
    expect(source).toContain("V207_REPAIRED_IMAGE_SOURCE_COMMIT");
    expect(source).not.toContain("FakeR2ArtifactPlane");
  });

  it("uses the full request lifetime and durable hosted finalization", () => {
    expect(source).toContain("lifetime_seconds: V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS");
    expect(source).toContain("const V207_OUTPUT_PORT_GET_MAX_LIFETIME_SECONDS = 900");
    expect(source).toContain('operation: "FINALIZE"');
    expect(source).toContain('schema_version !== "artifact-commit-receipt/v3"');
    expect(source).toContain("MAGE_COMMIT_RECEIPT_REPLAY_INVALID");
    expect(source).toContain("V207_OUTPUT_PORT_FINALIZE_TRANSPORT");
    expect(source).toContain("V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID");
    expect(source).toContain("V207_OUTPUT_PORT_FINALIZE_MAX_ATTEMPTS");
  });

  it("keeps successful FINALIZE replay ahead of a bounded resume GET and labels its failures", async () => {
    const calls: TestRecord[] = [];
    const receiptSha256 = `sha256:${"a".repeat(64)}`;
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as TestRecord;
      calls.push(body);
      if (body.operation === "FINALIZE") {
        return new Response(
          JSON.stringify({
            schema_version: "videoforge-v207-generated-output-finalization/v1",
            receipt: { receipt_sha256: receiptSha256 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          schema_version: "videoforge-v207-generated-output-read-port/v1",
          url: "https://signed.example/read",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const nonce = "b".repeat(64);
    const finalizeRequest = {
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "FINALIZE",
      reservation_id: "reservation-a",
      object_key: "outputs/scene-01.png",
      receipt: { receipt_sha256: receiptSha256 },
    };
    await expect(
      routePort(finalizeRequest, nonce, { fetchImpl, sleepImpl: async () => undefined }),
    ).resolves.toMatchObject({
      schema_version: "videoforge-v207-generated-output-finalization/v1",
    });
    await expect(
      routePort(finalizeRequest, nonce, { fetchImpl, sleepImpl: async () => undefined }),
    ).resolves.toMatchObject({
      schema_version: "videoforge-v207-generated-output-finalization/v1",
    });
    await expect(
      routePort(
        {
          schema_version: "videoforge-v207-generated-output-port-request/v1",
          operation: "GET",
          object_key: "outputs/scene-01.png",
          lifetime_seconds: 900,
        },
        nonce,
        { fetchImpl, sleepImpl: async () => undefined },
      ),
    ).resolves.toMatchObject({
      schema_version: "videoforge-v207-generated-output-read-port/v1",
    });
    expect(calls.map((call) => call.operation)).toEqual(["FINALIZE", "FINALIZE", "GET"]);
    expect(calls[2]?.lifetime_seconds).toBe(900);

    const replayStage = source.indexOf('failureStage = "output_finalization_replay"');
    const resumeStage = source.indexOf('failureStage = "output_resume_readback"');
    const resumeLifetime = source.indexOf(
      "lifetime_seconds: V207_OUTPUT_PORT_GET_MAX_LIFETIME_SECONDS",
      resumeStage,
    );
    expect(replayStage).toBeGreaterThan(-1);
    expect(resumeStage).toBeGreaterThan(replayStage);
    expect(resumeLifetime).toBeGreaterThan(resumeStage);
    expect(
      extractV207OutputContractDiagnostics(
        new V207OutputContractError(
          "SUCCEEDED",
          "V207_OUTPUT_PORT_400",
          { kind: "object", keys: ["items"] },
          "output_resume_readback",
        ),
      ),
    ).toMatchObject({
      output_failure_stage: "output_resume_readback",
      output_failure_code: "V207_OUTPUT_PORT_400",
    });
  });

  it("classifies non-FINALIZE GET transport and malformed responses without leaking details", async () => {
    const nonce = "b".repeat(64);
    const getRequest = { operation: "GET", object_key: "exact-object" };
    const secret = "secret-body https://signed.example/private?sig=secret nonce-" + nonce;
    let transportAttempts = 0;

    let transportThrown: unknown;
    try {
      await routePort(getRequest, nonce, {
        fetchImpl: async () => {
          transportAttempts += 1;
          throw new Error(secret);
        },
        sleepImpl: async () => undefined,
      });
    } catch (error) {
      transportThrown = error;
    }
    expect(transportThrown).toMatchObject({ message: "V207_OUTPUT_PORT_GET_TRANSPORT" });
    expect(transportAttempts).toBe(1);
    expect(String(transportThrown)).not.toContain(nonce);

    let bodyReadAttempts = 0;
    const bodyReadFailure = {
      ok: false,
      status: 503,
      arrayBuffer: async () => {
        throw new Error(secret);
      },
    } as unknown as Response;
    let bodyReadThrown: unknown;
    try {
      await routePort(getRequest, nonce, {
        fetchImpl: async () => {
          bodyReadAttempts += 1;
          return bodyReadFailure;
        },
        sleepImpl: async () => undefined,
      });
    } catch (error) {
      bodyReadThrown = error;
    }
    expect(bodyReadThrown).toMatchObject({ message: "V207_OUTPUT_PORT_GET_TRANSPORT" });
    expect(bodyReadAttempts).toBe(1);
    expect(String(bodyReadThrown)).not.toContain(nonce);

    let malformedThrown: unknown;
    let malformedAttempts = 0;
    try {
      await routePort(getRequest, nonce, {
        fetchImpl: async () => {
          malformedAttempts += 1;
          return new Response(secret, {
            status: 503,
            headers: {
              "content-type": "text/html; secret=must-not-persist",
            },
          });
        },
        sleepImpl: async () => undefined,
      });
    } catch (error) {
      malformedThrown = error;
    }
    expect(malformedThrown).toMatchObject({ message: "V207_OUTPUT_PORT_GET_RESPONSE_INVALID" });
    expect(malformedAttempts).toBe(1);
    expect(JSON.stringify(malformedThrown)).not.toContain("secret-body");
    expect(JSON.stringify(malformedThrown)).not.toContain("signed.example");
    expect(String(malformedThrown)).not.toContain(nonce);

    let valid503Attempts = 0;
    await expect(
      routePort(getRequest, nonce, {
        fetchImpl: async () => {
          valid503Attempts += 1;
          return new Response(JSON.stringify({ error: { code: "V207_PORT_SIGNING_FAILED" } }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        },
        sleepImpl: async () => undefined,
      }),
    ).rejects.toThrow("V207_OUTPUT_PORT_503");
    expect(valid503Attempts).toBe(1);

    expect(
      extractV207OutputContractDiagnostics(
        new V207OutputContractError(
          "SUCCEEDED",
          "V207_OUTPUT_PORT_GET_RESPONSE_INVALID",
          { kind: "object", keys: ["items", "provenance_receipt", "status"] },
          "output_readback",
        ),
      ),
    ).toEqual({
      error: "MAGE_OUTPUT_NOT_SUCCEEDED",
      error_category: "output_contract",
      output_failure_stage: "output_readback",
      output_status: "SUCCEEDED",
      output_failure_code: "V207_OUTPUT_PORT_GET_RESPONSE_INVALID",
      output_shape_kind: "object",
      output_shape_keys: ["items", "provenance_receipt", "status"],
    });
  });

  it("classifies signed artifact readback transport and preserves non-2xx failures", async () => {
    const signedUrl = "https://signed.example/private?sig=secret";
    const secret = "readback transport secret " + signedUrl;

    let fetchThrown: unknown;
    try {
      await readV207OutputReadback(signedUrl, {
        fetchImpl: async () => {
          throw new Error(secret);
        },
      });
    } catch (error) {
      fetchThrown = error;
    }
    expect(fetchThrown).toMatchObject({ message: "MAGE_OUTPUT_READBACK_TRANSPORT" });
    expect(String(fetchThrown)).not.toContain(signedUrl);
    expect(String(fetchThrown)).not.toContain(secret);

    const bodyReadFailure = {
      ok: true,
      arrayBuffer: async () => {
        throw new Error(secret);
      },
    } as unknown as Response;
    let bodyReadThrown: unknown;
    try {
      await readV207OutputReadback(signedUrl, {
        fetchImpl: async () => bodyReadFailure,
      });
    } catch (error) {
      bodyReadThrown = error;
    }
    expect(bodyReadThrown).toMatchObject({ message: "MAGE_OUTPUT_READBACK_TRANSPORT" });
    expect(String(bodyReadThrown)).not.toContain(signedUrl);
    expect(String(bodyReadThrown)).not.toContain(secret);

    await expect(
      readV207OutputReadback(signedUrl, {
        fetchImpl: async () => new Response("provider failure", { status: 502 }),
      }),
    ).rejects.toThrow("MAGE_OUTPUT_READBACK_FAILED");
  });

  it("routes post-timeout reader results through both full verifiers before drain", () => {
    const timeoutTerminal = source.indexOf('persistCheckpoint("timeout-terminal"');
    const concurrentPolicy = source.indexOf("await harness.applyConcurrentReaderPolicy()");
    const reconcile = source.indexOf(
      "const readerResults = await harness.reconcileConcurrentReaders",
    );
    const verifyReaderA = source.indexOf(
      "const readerEvidenceA = await verifyBatchWithDiagnostic",
      reconcile,
    );
    const verifyReaderB = source.indexOf(
      "const readerEvidenceB = await verifyBatchWithDiagnostic",
      verifyReaderA + 1,
    );
    const recordReaderA = source.indexOf('kind: "reader_a"', verifyReaderB);
    const recordReaderB = source.indexOf('kind: "reader_b"', recordReaderA);
    const drain = source.indexOf("await harness.drain()", recordReaderB);
    expect([
      timeoutTerminal,
      concurrentPolicy,
      reconcile,
      verifyReaderA,
      verifyReaderB,
      recordReaderA,
      recordReaderB,
      drain,
    ]).toEqual(
      [
        timeoutTerminal,
        concurrentPolicy,
        reconcile,
        verifyReaderA,
        verifyReaderB,
        recordReaderA,
        recordReaderB,
        drain,
      ].sort((left, right) => left - right),
    );
    expect(timeoutTerminal).toBeGreaterThan(-1);
  });

  it("retries only idempotent FINALIZE transport loss and accepts the later receipt", async () => {
    let attempts = 0;
    const fetchImpl: typeof fetch = async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("simulated transport timeout");
      return new Response(
        JSON.stringify({
          schema_version: "videoforge-v207-generated-output-finalization/v1",
          receipt: { receipt_sha256: `sha256:${"a".repeat(64)}` },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const value = await routePort(
      { operation: "FINALIZE", object_key: "exact-object" },
      "b".repeat(64),
      { fetchImpl, sleepImpl: async () => undefined },
    );
    expect(attempts).toBe(3);
    expect(value.schema_version).toBe("videoforge-v207-generated-output-finalization/v1");
  });

  it("surfaces bounded finalization transport and response codes after retry exhaustion", async () => {
    let transportAttempts = 0;
    const transportFetch: typeof fetch = async () => {
      transportAttempts += 1;
      throw new Error("simulated transport timeout");
    };
    await expect(
      routePort({ operation: "FINALIZE", object_key: "exact-object" }, "b".repeat(64), {
        fetchImpl: transportFetch,
        sleepImpl: async () => undefined,
      }),
    ).rejects.toThrow("V207_OUTPUT_PORT_FINALIZE_TRANSPORT");
    expect(transportAttempts).toBe(6);

    let responseAttempts = 0;
    const responseFetch: typeof fetch = async () => {
      responseAttempts += 1;
      return new Response("not-json", { status: 200 });
    };
    await expect(
      routePort({ operation: "FINALIZE", object_key: "exact-object" }, "b".repeat(64), {
        fetchImpl: responseFetch,
        sleepImpl: async () => undefined,
      }),
    ).rejects.toThrow("V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID");
    expect(responseAttempts).toBe(6);

    let putAttempts = 0;
    const putFetch: typeof fetch = async () => {
      putAttempts += 1;
      throw new Error("put transport failure");
    };
    await expect(
      routePort({ operation: "PUT", object_key: "exact-object" }, "b".repeat(64), {
        fetchImpl: putFetch,
        sleepImpl: async () => undefined,
      }),
    ).rejects.toThrow("put transport failure");
    expect(putAttempts).toBe(1);
  });

  it.each([
    ["empty", "", "application/json", "json_parse", 0],
    [
      "non-JSON",
      "provider body https://signed.example/secret?sig=raw",
      "text/plain; charset=utf-8",
      "json_parse",
      51,
    ],
    ["JSON non-object", JSON.stringify(["provider-secret"]), "application/json", "non_object", 19],
  ] as const)(
    "records bounded FINALIZE diagnostics for %s responses",
    async (_label, body, contentType, failureCategory, bodyByteLength) => {
      let attempts = 0;
      let thrown: unknown;
      try {
        await routePort({ operation: "FINALIZE", object_key: "exact-object" }, "b".repeat(64), {
          fetchImpl: async () => {
            attempts += 1;
            return new Response(body, {
              status: 200,
              headers: { "content-type": contentType },
            });
          },
          sleepImpl: async () => undefined,
        });
      } catch (error) {
        thrown = error;
      }
      expect(attempts).toBe(6);
      const diagnostic = (thrown as { diagnostic?: unknown } | null)?.diagnostic;
      expect(diagnostic).toEqual({
        attempt_number: 6,
        http_status: 200,
        content_type_category: contentType.startsWith("application/") ? "json" : "text",
        content_type_value: contentType.split(";", 1)[0],
        body_byte_length: bodyByteLength,
        failure_category: failureCategory,
      });
      expect(
        extractV207OutputContractDiagnostics(
          new V207OutputContractError(
            "MISSING",
            "V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID",
            { kind: "missing", keys: [] },
            "output_finalization",
            diagnostic,
          ),
        ),
      ).toMatchObject({ finalize_response_diagnostic: diagnostic });
      expect(redactV207LiveEvidence({ finalize_response_diagnostic: diagnostic })).toEqual({
        finalize_response_diagnostic: diagnostic,
      });
    },
  );

  it("records a bounded allowlisted FINALIZE HTTP error without retrying an old contract", async () => {
    let attempts = 0;
    let thrown: unknown;
    try {
      await routePort({ operation: "FINALIZE", object_key: "exact-object" }, "b".repeat(64), {
        fetchImpl: async () => {
          attempts += 1;
          return new Response(
            JSON.stringify({
              error: { code: "V207_REQUEST_INVALID", detail: "provider body must not persist" },
            }),
            {
              status: 400,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "x-provider-secret": "must-not-persist",
              },
            },
          );
        },
        sleepImpl: async () => undefined,
      });
    } catch (error) {
      thrown = error;
    }
    expect(attempts).toBe(1);
    const diagnostic = (thrown as { diagnostic?: unknown } | null)?.diagnostic;
    expect(diagnostic).toEqual({
      attempt_number: 1,
      http_status: 400,
      content_type_category: "json",
      content_type_value: "application/json",
      body_byte_length: Buffer.byteLength(
        JSON.stringify({
          error: { code: "V207_REQUEST_INVALID", detail: "provider body must not persist" },
        }),
      ),
      failure_category: "http_error",
      error_code: "V207_REQUEST_INVALID",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("provider body");
    expect(JSON.stringify(diagnostic)).not.toContain("must-not-persist");
  });

  it("redacts an unknown FINALIZE HTTP error code to null", async () => {
    let thrown: unknown;
    try {
      await routePort({ operation: "FINALIZE", object_key: "exact-object" }, "b".repeat(64), {
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: { code: "V207_PROVIDER_SECRET_DETAIL" } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        sleepImpl: async () => undefined,
      });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { diagnostic?: Record<string, unknown> }).diagnostic).toMatchObject({
      failure_category: "http_error",
      error_code: null,
    });
  });

  it("does not leak FINALIZE response body, URL, nonce, or non-content-type headers", async () => {
    const secretBody =
      "secret-body https://signed.example/private?sig=secret nonce-" + "b".repeat(64);
    let thrown: unknown;
    try {
      await routePort({ operation: "FINALIZE", object_key: "exact-object" }, "b".repeat(64), {
        fetchImpl: async () =>
          new Response(secretBody, {
            status: 200,
            headers: {
              "content-type": "text/plain; charset=utf-8; secret=must-not-persist",
              "x-provider-secret": "must-not-persist",
            },
          }),
        sleepImpl: async () => undefined,
      });
    } catch (error) {
      thrown = error;
    }
    const diagnostic = (thrown as { diagnostic?: unknown } | null)?.diagnostic;
    expect(diagnostic).toEqual({
      attempt_number: 6,
      http_status: 200,
      content_type_category: "text",
      content_type_value: "text/plain",
      body_byte_length: Buffer.byteLength(secretBody),
      failure_category: "json_parse",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret-body");
    expect(JSON.stringify(diagnostic)).not.toContain("signed.example");
    expect(JSON.stringify(diagnostic)).not.toContain("must-not-persist");
    expect(JSON.stringify(diagnostic)).not.toContain("bbbbbbbb");
    expect(Object.keys(diagnostic as object).sort()).toEqual([
      "attempt_number",
      "body_byte_length",
      "content_type_category",
      "content_type_value",
      "failure_category",
      "http_status",
    ]);
  });

  it("survives the bounded transient 503 burst observed in Attempt33", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const value = await routePort(
      { operation: "FINALIZE", object_key: "exact-object" },
      "b".repeat(64),
      {
        fetchImpl: async () => {
          attempts += 1;
          if (attempts < 6) {
            return new Response("transient edge failure", {
              status: 503,
              headers: { "content-type": "text/html" },
            });
          }
          return new Response(
            JSON.stringify({
              schema_version: "videoforge-v207-generated-output-finalization/v1",
              receipt: { receipt_sha256: `sha256:${"a".repeat(64)}` },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
        sleepImpl: async (milliseconds) => {
          delays.push(milliseconds);
        },
      },
    );
    expect(attempts).toBe(6);
    expect(delays).toEqual([1_000, 2_000, 3_000, 4_000, 5_000]);
    expect(value.schema_version).toBe("videoforge-v207-generated-output-finalization/v1");
  });

  it("requires one exact 32-image 1280x720 PNG batch with full receipts", () => {
    expect(source).toContain("assertV207ItemCount(itemCount)");
    expect(source).toContain("output.items.length !== itemCount");
    expect(source).toContain("receiptItems.length !== objectKeys.length");
    expect(source).toContain("png.readUInt32BE(16) !== 1280");
    expect(source).toContain("png.readUInt32BE(20) !== 720");
    expect(source).toContain("MAGE_RECEIPT_IDENTITY_INVALID");
  });

  it("retains timing provenance while separating worker-local and provider status clocks", () => {
    const redacted = redactV207LiveEvidence({
      timing_provenance: {
        schema_version: "videoforge-serverless-timing-provenance/v1",
        provider_timing_source: "RUNPOD_STATUS_DELAY_TIME_MS_AND_EXECUTION_TIME_MS",
        worker_timing_source: "SIGNED_ENVELOPE_ISSUED_AT_TO_LOCAL_RUNTIME_BOUNDARIES",
        signed_envelope_issued_at: "2026-08-23T00:00:00.000Z",
        process_start_boundary: "MAGE_RUNTIME_STARTED_OR_HANDLER_ADMISSION_MONOTONIC",
        container_ready_boundary: "HANDLER_RUNTIME_READY_MONOTONIC",
        provider_delay_time_ms: 123,
        provider_execution_time_ms: 456,
      },
    });
    expect(redacted.timing_provenance).toMatchObject({
      schema_version: "videoforge-serverless-timing-provenance/v1",
      provider_timing_source: "RUNPOD_STATUS_DELAY_TIME_MS_AND_EXECUTION_TIME_MS",
      worker_timing_source: "SIGNED_ENVELOPE_ISSUED_AT_TO_LOCAL_RUNTIME_BOUNDARIES",
      signed_envelope_issued_at: "2026-08-23T00:00:00.000Z",
      process_start_boundary: "MAGE_RUNTIME_STARTED_OR_HANDLER_ADMISSION_MONOTONIC",
      container_ready_boundary: "HANDLER_RUNTIME_READY_MONOTONIC",
      provider_delay_time_ms: 123,
      provider_execution_time_ms: 456,
    });
  });

  it("narrows the sealed worker's remote contract to one exact 32-item video batch", () => {
    for (const itemCount of [0, 1, 16, 31, 33, 64, 65]) {
      expect(() => assertV207ItemCount(itemCount)).toThrow("V207_BATCH_ITEM_COUNT_INVALID");
    }
    expect(() => assertV207ItemCount(1.5)).toThrow("V207_BATCH_ITEM_COUNT_INVALID");
    expect(() => assertV207ItemCount(32)).not.toThrow();
    expect(source).toContain("QUALIFICATION_SCENES.slice(0, itemCount)");
    expect(source).toContain("item_count: executionItems.length");
    expect(source).toContain("new V207OutputContractError");
  });

  it("uses whole-project batches and does not run the obsolete seed/resume successor path", () => {
    const liveBatchCounts = [
      ...source.matchAll(
        /(?:probe|cold|warm|readerA|readerB|cancel|timeout) = await createBatch\([\s\S]*?workerToken,\s+generatedObjectKeys,\s+(\d+),/g,
      ),
    ].map((match) => match[1]);
    expect(liveBatchCounts).toEqual(["32", "32", "32", "32", "32", "32"]);
    expect(source).not.toContain("prepareProcessReplacement");
    expect(source).not.toContain("rotateEndpointForProcessReplacement");
    expect(source).not.toContain("process_replacement_endpoint_rotation");
    expect(source).not.toContain("const resumeBatch = await createBatch");
    expect(source).not.toContain("workerToken,\n        1,");
    expect(() => assertV207ItemCount(31)).toThrow("V207_BATCH_ITEM_COUNT_INVALID");
  });

  it("shares partial batch keys before PUT and never reports an empty rollback as confirmed", () => {
    const createBatchStart = source.indexOf("async function createBatch(");
    const ledgerAdd = source.indexOf("rollbackObjectKeys.add(objectKey)", createBatchStart);
    const putPort = source.indexOf("const signed = await routePort(", createBatchStart);
    const dispatch = source.indexOf("await harness.dispatchBatch(cold.input)", putPort);
    expect(createBatchStart).toBeGreaterThan(-1);
    expect(ledgerAdd).toBeGreaterThan(createBatchStart);
    expect(putPort).toBeGreaterThan(ledgerAdd);
    expect(dispatch).toBeGreaterThan(putPort);
    expect(source).toContain("generatedObjectKeys.size === 0");
    expect(source).toContain('evidence.generated_output_rollback = "NOT_REQUIRED"');
    expect(source).not.toContain(
      'await deleteGeneratedObjects(generatedObjectKeys, nonce);\n        evidence.generated_output_rollback = "CONFIRMED"',
    );
  });

  it("uses unique attempt lineage, deletes disposables on success, and proves final zero inventory", () => {
    expect(source).toContain("randomBytes(6)");
    expect(source).toContain("AbortSignal.timeout(30_000)");
    expect(source).toContain("cleanupSuccessfulQualification");
    expect(source).toContain("reconcileV207Readonly");
    expect(source).toContain("final_reconciliation");
    expect(source).toContain("pre_delete_queue_and_workers_zero");
    expect(source).toContain("final_three_read_zero_compute_and_disposable_reconciliation");
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
    expect(source).toContain("fetchCp07Catalog");
    expect(source).toContain("V207_CATALOG_RATE_OR_VRAM_DRIFT");
    expect(source).toContain("selected_catalog_offering");
  });

  it("fails closed when the fresh exact GPU catalog observation is unavailable or drifts", () => {
    const candidate = {
      offeringId: "NVIDIA GeForce RTX 4090",
      displayName: "RTX 4090",
      region: "EU-RO-1",
      secureCloud: true,
      availability: "LOW",
      rateUsdPerHour: V207_SECURE_REFERENCE_RATE_USD_PER_HOUR,
      vramGb: 24,
    } as const;
    expect(assertV207FreshCatalogOffering([candidate])).toEqual(candidate);
    expect(
      assertV207FreshCatalogOffering([{ ...candidate, availability: "MEDIUM" }]),
    ).toMatchObject({ availability: "MEDIUM" });
    expect(assertV207FreshCatalogOffering([{ ...candidate, availability: "HIGH" }])).toMatchObject({
      availability: "HIGH",
    });
    expect(() =>
      assertV207FreshCatalogOffering([{ ...candidate, offeringId: "NVIDIA L4" }]),
    ).toThrow("V207_CATALOG_RTX4090_EU_RO_1_UNAVAILABLE");
    expect(() => assertV207FreshCatalogOffering([{ ...candidate, rateUsdPerHour: 0.75 }])).toThrow(
      "V207_CATALOG_RATE_OR_VRAM_DRIFT",
    );
    expect(() => assertV207FreshCatalogOffering([{ ...candidate, vramGb: 23 }])).toThrow(
      "V207_CATALOG_RATE_OR_VRAM_DRIFT",
    );
    expect(V207_SERVERLESS_FLEX_RATE_USD_PER_GPU_HOUR).toBe(1.116);
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

  it("owns a separate real provider timeout attempt and rejects local/failed substitutes", () => {
    expect(source).toContain("const timeoutAttemptId = `v207-timeout-${runTag}`");
    expect(source).toContain("await harness.dispatchTimeoutBatch(timeout.input)");
    expect(source).toContain("const timeoutResult = await harness.reconcile(timeoutJob.id)");
    expect(source).toContain('timeoutResult.status !== "TIMED_OUT"');
    expect(source).toContain('throw new Error("V207_TIMEOUT_NOT_OBSERVED")');
    expect(source).toContain('event: "provider_timeout_terminal"');
    expect(source).toContain('evidence.timeout_output_cleanup = "CONFIRMED"');
  });

  it("does not rotate a seed endpoint or redispatch a 31-unit replacement", () => {
    expect(source).not.toContain("processReplacementEndpointRotation");
    expect(source).not.toContain("replacementEndpointIdHash");
    expect(source).not.toContain("resumeEvidence");
    expect(source).not.toContain("mergedResumeUnits");
    const drain = source.indexOf('persistCheckpoint("reader-drained")');
    const outputCleanup = source.indexOf("deleteV207GeneratedObjects(generatedObjectKeys, nonce)");
    const deleteDisposables = source.indexOf("cleanupSuccessfulQualification");
    const finalReconciliation = source.indexOf(
      "const finalReconciliation = await reconcileV207Readonly",
    );
    expect(drain).toBeGreaterThan(-1);
    expect(outputCleanup).toBeGreaterThan(drain);
    expect(deleteDisposables).toBeGreaterThan(drain);
    expect(deleteDisposables).toBeGreaterThan(outputCleanup);
    expect(finalReconciliation).toBeGreaterThan(deleteDisposables);
    expect(source).toContain('evidence.generated_output_cleanup = "CONFIRMED"');
  });

  it("uses both post-timeout reader receipts as the terminal sealed-model attestation", () => {
    const cancelTerminal = source.indexOf('persistCheckpoint("cancel-terminal")');
    const timeoutTerminal = source.indexOf('persistCheckpoint("timeout-terminal"');
    const concurrentPolicy = source.indexOf("await harness.applyConcurrentReaderPolicy()");
    const readerDispatch = source.indexOf(
      "const readerJobs = await harness.dispatchConcurrentReaders",
    );
    const readerVerifyA = source.indexOf("const readerEvidenceA = await verifyBatchWithDiagnostic");
    const readerVerifyB = source.indexOf(
      "const readerEvidenceB = await verifyBatchWithDiagnostic",
      readerVerifyA + 1,
    );
    const terminalConfirmed = source.indexOf("evidence.terminal_sealed_model_attestation = {");
    const readerTerminal = source.indexOf('persistCheckpoint("reader-terminal-attestation")');
    const readerDrain = source.indexOf("await harness.drain()", readerTerminal);
    const restoreMaxOne = source.indexOf("await harness.scaleDownToInitial()", readerDrain);
    const finalReconciliation = source.indexOf(
      "const finalReconciliation = await reconcileV207Readonly",
    );
    const success = source.indexOf("success = true", finalReconciliation);
    expect([
      cancelTerminal,
      timeoutTerminal,
      concurrentPolicy,
      readerDispatch,
      readerVerifyA,
      readerVerifyB,
      terminalConfirmed,
      readerTerminal,
      readerDrain,
      restoreMaxOne,
      finalReconciliation,
      success,
    ]).toEqual(
      [
        cancelTerminal,
        timeoutTerminal,
        concurrentPolicy,
        readerDispatch,
        readerVerifyA,
        readerVerifyB,
        terminalConfirmed,
        readerTerminal,
        readerDrain,
        restoreMaxOne,
        finalReconciliation,
        success,
      ].sort((left, right) => left - right),
    );
    expect(cancelTerminal).toBeGreaterThan(-1);
    expect(source.match(/terminal_sealed_model_attestation: true/g)).toHaveLength(2);
    expect(source).toContain(
      "reader_receipt_sha256: [readerEvidenceA.receipt_sha256, readerEvidenceB.receipt_sha256]",
    );
    expect(source).toContain("manifest_sha256: MANIFEST");
    expect(source).toContain("evidence.no_gpu_action_after_terminal_attestation = true");
    expect(source).not.toContain("terminalAttestationJob");
    expect(source.slice(readerTerminal, finalReconciliation)).not.toMatch(
      /dispatch(?:Batch|TimeoutBatch|ConcurrentReaders)/,
    );
  });

  it("binds the sealed worker's existing scratch implementation to its exact staged job path", () => {
    expect(source).toContain('const V207_JOB_SCRATCH_ROOT = "/tmp/videoforge-jobs"');
    expect(source).toContain("VIDEOFORGE_JOB_SCRATCH_ROOT: V207_JOB_SCRATCH_ROOT");
    expect(source).toContain(
      "exact_job_path: `${V207_JOB_SCRATCH_ROOT}/jobs/${expectedAttemptId}`",
    );
    expect(source).toContain("scratchCleanup?.removed !== true");
    expect(source).toContain("scratchCleanup?.scratch_on_model_volume !== false");
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

  it("retains only a bounded, redacted root provider job error for failed output diagnostics", () => {
    const redacted = redactV207ProviderJobError({
      code: "MAGE_SERVERLESS_HANDLER_UNEXPECTED",
      message: "signed URL and secret must not escape",
      job_id: "job-raw",
    });
    expect(redacted).toEqual({
      provider_error: {
        code: "MAGE_SERVERLESS_HANDLER_UNEXPECTED",
        message: "[REDACTED]",
        job_id: "[REDACTED]",
      },
    });
    expect(redactV207ProviderJobError(new Array(1_000).fill("MAGE_PROVIDER_ERROR"))).toEqual({
      provider_error: "[REDACTED_SIZE]",
    });
    expect(redactV207ProviderJobError(undefined)).toEqual({});
    expect(source).toContain("job.error");
    expect(source).toContain("v207:provider-job-error=");
  });

  it("uses the root provider job.error code when output is missing or failed", () => {
    expect(
      extractV207ProviderJobErrorCode({ code: "MAGE_SERVERLESS_HANDLER_UNEXPECTED" }, undefined),
    ).toBe("MAGE_SERVERLESS_HANDLER_UNEXPECTED");
    expect(
      extractV207ProviderJobErrorCode(
        { code: "MAGE_ROOT_ERROR" },
        { status: "FAILED", failure_code: "MAGE_OUTPUT_ERROR" },
      ),
    ).toBe("MAGE_ROOT_ERROR");
    expect(
      extractV207ProviderJobErrorCode(undefined, {
        status: "FAILED",
        failure_code: "MAGE_OUTPUT_ERROR",
      }),
    ).toBe("MAGE_OUTPUT_ERROR");
  });

  it("persists bounded output-contract diagnostics for a completed non-success", () => {
    const error = new V207OutputContractError("FAILED", "MAGE_OUTPUT_ERROR", {
      kind: "object",
      keys: ["status", "failure_code", "secret_token", "status"],
    });
    expect(extractV207OutputContractDiagnostics(error)).toEqual({
      error: "MAGE_OUTPUT_NOT_SUCCEEDED",
      error_category: "output_contract",
      output_failure_stage: "top_level",
      output_status: "FAILED",
      output_failure_code: "MAGE_OUTPUT_ERROR",
      output_shape_kind: "object",
      output_shape_keys: ["failure_code", "status"],
    });
    expect(redactV207LiveEvidence(extractV207OutputContractDiagnostics(error))).toEqual(
      extractV207OutputContractDiagnostics(error),
    );
  });

  it("fails closed and redacts unsafe output-contract fields", () => {
    const error = new V207OutputContractError(
      "FAILED:secret-body",
      "MAGE_OUTPUT_ERROR:secret-body",
      {
        kind: "provider-secret",
        keys: ["status", "authorization", "secret_token", "items"],
      },
    );
    expect(extractV207OutputContractDiagnostics(error)).toEqual({
      error: "MAGE_OUTPUT_NOT_SUCCEEDED",
      error_category: "output_contract",
      output_failure_stage: "top_level",
      output_status: "MISSING",
      output_failure_code: "UNKNOWN",
      output_shape_kind: "missing",
      output_shape_keys: ["items", "status"],
    });
    expect(extractV207OutputContractDiagnostics(new Error("MAGE_OUTPUT_NOT_SUCCEEDED"))).toBe(null);
    expect(
      JSON.stringify(redactV207LiveEvidence(extractV207OutputContractDiagnostics(error))),
    ).not.toContain("secret");
  });

  it("extracts structurally branded downstream diagnostics without trusting raw fields", () => {
    const diagnostic = extractV207OutputContractDiagnostics({
      diagnosticBrand: "videoforge.v207.output-contract-diagnostic/v1",
      code: "MAGE_OUTPUT_NOT_SUCCEEDED",
      outputStatus: "SUCCEEDED",
      failureCode: "MAGE_RECEIPT_MISSING",
      failureStage: "receipt_presence",
      outputShape: {
        kind: "object",
        keys: ["status", "items", "authorization", "provenance_receipt"],
      },
      provider_body: {
        url: "https://signed.example/private?sig=secret",
        message: "secret body must not persist",
      },
    });
    expect(diagnostic).toEqual({
      error: "MAGE_OUTPUT_NOT_SUCCEEDED",
      error_category: "output_contract",
      output_failure_stage: "receipt_presence",
      output_status: "SUCCEEDED",
      output_failure_code: "MAGE_RECEIPT_MISSING",
      output_shape_kind: "object",
      output_shape_keys: ["items", "provenance_receipt", "status"],
    });
    expect(JSON.stringify(diagnostic)).not.toContain("signed.example");
    const redacted = redactV207LiveEvidence({
      ...diagnostic,
      provider_body: {
        url: "https://signed.example/private?sig=secret",
        body: "secret body",
      },
    });
    expect(JSON.stringify(redacted)).not.toContain("signed.example");
    expect(JSON.stringify(redacted)).not.toContain("secret body");
    expect(extractV207OutputContractDiagnostics({ code: "MAGE_OUTPUT_NOT_SUCCEEDED" })).toBe(null);
  });

  it("covers every bounded verification stage and fails closed for unsafe stages/codes", () => {
    for (const stage of [
      "item_count",
      "authority_count",
      "receipt_presence",
      "receipt_hash",
      "receipt_signature",
      "receipt_identity",
      "output_lineage",
      "output_readback",
      "output_png_probe",
      "output_finalization",
      "output_finalization_replay",
      "output_resume_readback",
    ]) {
      expect(source).toContain(`failureStage = "${stage}"`);
    }
    expect(source).toContain('let failureStage: V207OutputFailureStage = "top_level"');
    expect(source).toContain("diagnosticBrand");
    expect(source).toContain("isV207OutputContractDiagnostic");
    expect(source).toContain("boundedV207FailureCode");
    expect(
      extractV207OutputContractDiagnostics({
        diagnosticBrand: "videoforge.v207.output-contract-diagnostic/v1",
        code: "MAGE_OUTPUT_NOT_SUCCEEDED",
        outputStatus: "FAILED:secret-body",
        failureCode: "MAGE_FAILURE:secret-body",
        failureStage: "provider-secret",
        outputShape: { kind: "provider-secret", keys: ["authorization", "items"] },
      }),
    ).toEqual({
      error: "MAGE_OUTPUT_NOT_SUCCEEDED",
      error_category: "output_contract",
      output_failure_stage: "unknown",
      output_status: "MISSING",
      output_failure_code: "UNKNOWN",
      output_shape_kind: "missing",
      output_shape_keys: ["items"],
    });
  });

  it("persists only an allow-listed endpoint readback mismatch category", () => {
    const categories = [
      "identity",
      "environment",
      "flashboot",
      "region",
      "cuda",
      "volume",
      "gpu",
      "workers",
      "timing",
      "scaler",
    ] as const;
    for (const category of categories) {
      const error = new RunPodControlError(
        "RUNPOD_ENDPOINT_ID_BINDING_READBACK_UNCONFIRMED",
        category,
      );
      expect(extractV207EndpointReadbackMismatchCategory(error)).toBe(category);
      expect(
        redactV207LiveEvidence({
          error: error.code,
          error_category: category,
          response_id: "endpoint-raw",
          env: { SECRET: "must-not-persist" },
        }),
      ).toMatchObject({
        error: error.code,
        error_category: category,
      });
    }
    expect(extractV207EndpointReadbackMismatchCategory(new RunPodControlError("OTHER"))).toBe(null);
    expect(extractV207EndpointReadbackMismatchCategory(new Error("environment"))).toBe(null);
    expect(
      extractV207EndpointReadbackMismatchCategory(
        new RunPodControlError(
          "RUNPOD_ENDPOINT_ID_BINDING_READBACK_UNCONFIRMED",
          "provider-secret" as never,
        ),
      ),
    ).toBe(null);
    expect(redactV207LiveEvidence({ error_category: "provider-secret" })).toEqual({
      error_category: "[REDACTED]",
    });
    const serialized = JSON.stringify(
      redactV207LiveEvidence({
        error_category: "environment",
        response_id: "endpoint-raw",
        env: { SECRET: "must-not-persist" },
      }),
    );
    expect(serialized).not.toContain("endpoint-raw");
    expect(serialized).not.toContain("must-not-persist");
    expect(source).toContain("evidence.error_category = errorCategory");
    expect(source).toContain("extractV207EndpointReadbackMismatchCategory(error)");
  });
});
