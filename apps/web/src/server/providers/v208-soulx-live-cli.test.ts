// @vitest-environment node

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertV208ExecutionControlSource,
  assertV208SingleUseJournalBinding,
  createV208CleanupAttributableResource,
  createV208LocalVerifiedOutputWriter,
  readV208BinaryFd,
  readV208TextFd,
  runV208SoulXLiveCli,
} from "./v208-soulx-live-cli.js";

const STAGE_AUTHORITY = "authority-v208-soulx";
const RESOURCE_KEY = `v213-${STAGE_AUTHORITY}-soulx-qualification`;
const sha256 = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;

function durable(value: unknown) {
  return {
    readSnapshot: vi.fn(() => value as never),
  };
}

describe("V2-08 live composition", () => {
  it("preserves accepted cold and warm outputs at private deterministic paths", async () => {
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), "v208-verified-output-")));
    const journal = join(temporary, "journal");
    mkdirSync(journal, { mode: 0o700 });
    const writeVerifiedOutputs = createV208LocalVerifiedOutputWriter(journal);
    const outputs = ([2, 4, 6, 10] as const).map((seconds) => {
      const bytes = Uint8Array.from([seconds, 0, 1, 2]);
      return { itemId: `soulx-${seconds}s`, sha256: sha256(bytes), bytes };
    });
    try {
      for (const temperature of ["cold", "warm"] as const) {
        await writeVerifiedOutputs({
          descriptorId: `soulx-${temperature}-whole-span-2-4-6-10s`,
          outputs,
        });
      }
      // Exact re-entry is safe; a different payload is never allowed to replace it.
      await writeVerifiedOutputs({
        descriptorId: "soulx-cold-whole-span-2-4-6-10s",
        outputs,
      });
      for (const temperature of ["cold", "warm"] as const) {
        const directory = join(
          journal,
          "verified-outputs",
          `soulx-${temperature}-whole-span-2-4-6-10s`,
        );
        expect(lstatSync(directory).mode & 0o777).toBe(0o700);
        for (const output of outputs) {
          const path = join(directory, `${output.itemId}.mp4`);
          expect(lstatSync(path).mode & 0o777).toBe(0o600);
          expect(readFileSync(path)).toEqual(Buffer.from(output.bytes));
        }
      }
      const changed = Uint8Array.from([2, 9, 9, 9]);
      await expect(
        writeVerifiedOutputs({
          descriptorId: "soulx-cold-whole-span-2-4-6-10s",
          outputs: outputs.map((output) =>
            output.itemId === "soulx-2s"
              ? { ...output, bytes: changed, sha256: sha256(changed) }
              : output,
          ),
        }),
      ).rejects.toThrow("V208_VERIFIED_OUTPUT_EXISTING_MISMATCH");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("refuses a symlink at a verified output path", async () => {
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), "v208-verified-symlink-")));
    const journal = join(temporary, "journal");
    const descriptor = "soulx-cold-whole-span-2-4-6-10s";
    const directory = join(journal, "verified-outputs", descriptor);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = join(temporary, "target.mp4");
    writeFileSync(target, Buffer.from([2, 0, 1, 2]), { mode: 0o600 });
    symlinkSync(target, join(directory, "soulx-2s.mp4"));
    const outputs = ([2, 4, 6, 10] as const).map((seconds) => {
      const bytes = Uint8Array.from([seconds, 0, 1, 2]);
      return { itemId: `soulx-${seconds}s`, sha256: sha256(bytes), bytes };
    });
    try {
      await expect(
        createV208LocalVerifiedOutputWriter(journal)({ descriptorId: descriptor, outputs }),
      ).rejects.toThrow("V208_VERIFIED_OUTPUT_EXISTING_MISMATCH");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("refuses symlinked journal and descriptor directories", async () => {
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), "v208-verified-directory-link-")));
    const actualJournal = join(temporary, "actual-journal");
    const linkedJournal = join(temporary, "linked-journal");
    mkdirSync(actualJournal, { mode: 0o700 });
    symlinkSync(actualJournal, linkedJournal);
    const outputs = ([2, 4, 6, 10] as const).map((seconds) => {
      const bytes = Uint8Array.from([seconds, 0, 1, 2]);
      return { itemId: `soulx-${seconds}s`, sha256: sha256(bytes), bytes };
    });
    try {
      await expect(
        createV208LocalVerifiedOutputWriter(linkedJournal)({
          descriptorId: "soulx-cold-whole-span-2-4-6-10s",
          outputs,
        }),
      ).rejects.toThrow("V208_VERIFIED_OUTPUT_DIRECTORY_INVALID");

      const root = join(actualJournal, "verified-outputs");
      const target = join(temporary, "descriptor-target");
      mkdirSync(root, { mode: 0o700 });
      mkdirSync(target, { mode: 0o700 });
      symlinkSync(target, join(root, "soulx-cold-whole-span-2-4-6-10s"));
      await expect(
        createV208LocalVerifiedOutputWriter(actualJournal)({
          descriptorId: "soulx-cold-whole-span-2-4-6-10s",
          outputs,
        }),
      ).rejects.toThrow("V208_VERIFIED_OUTPUT_DIRECTORY_INVALID");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("never publishes or retains a partial temporary output", async () => {
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), "v208-verified-partial-")));
    const journal = join(temporary, "journal");
    mkdirSync(journal, { mode: 0o700 });
    const outputs = ([2, 4, 6, 10] as const).map((seconds) => {
      const bytes = Uint8Array.from([seconds, 0, 1, 2]);
      return { itemId: `soulx-${seconds}s`, sha256: sha256(bytes), bytes };
    });
    let writeCount = 0;
    try {
      await expect(
        createV208LocalVerifiedOutputWriter(journal, {
          createTempToken: () => "a".repeat(32),
          writeChunk: (descriptor, bytes) => {
            writeCount += 1;
            if (writeCount > 1) throw new Error("simulated-mid-write-failure");
            return writeSync(descriptor, bytes.subarray(0, 2));
          },
        })({ descriptorId: "soulx-cold-whole-span-2-4-6-10s", outputs }),
      ).rejects.toThrow("V208_VERIFIED_OUTPUT_WRITE_FAILED");
      const directory = join(journal, "verified-outputs", "soulx-cold-whole-span-2-4-6-10s");
      expect(readdirSync(directory)).toEqual([]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("recovers safely from a preexisting private temporary name", async () => {
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), "v208-verified-stale-")));
    const journal = join(temporary, "journal");
    const descriptorId = "soulx-cold-whole-span-2-4-6-10s";
    const directory = join(journal, "verified-outputs", descriptorId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const staleToken = "a".repeat(32);
    const stale = join(directory, `.soulx-2s.${staleToken}.tmp`);
    writeFileSync(stale, Buffer.from("stale"), { mode: 0o600 });
    const outputs = ([2, 4, 6, 10] as const).map((seconds) => {
      const bytes = Uint8Array.from([seconds, 0, 1, 2]);
      return { itemId: `soulx-${seconds}s`, sha256: sha256(bytes), bytes };
    });
    const tokens = [staleToken, ...["b", "c", "d", "e", "f"].map((value) => value.repeat(32))];
    try {
      await createV208LocalVerifiedOutputWriter(journal, {
        createTempToken: () => tokens.shift()!,
      })({ descriptorId, outputs });
      expect(readFileSync(join(directory, "soulx-2s.mp4"))).toEqual(Buffer.from(outputs[0]!.bytes));
      expect(readFileSync(stale)).toEqual(Buffer.from("stale"));
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("pins direct CLI execution to one clean authority successor", () => {
    const control = "b".repeat(40);
    const runGit = vi.fn((_command: string, args: string[]) => {
      const operation = args.slice(2).join(" ");
      if (operation.startsWith("status ")) return "";
      if (operation === "rev-parse HEAD^{commit}") return `${"c".repeat(40)}\n`;
      if (operation === "rev-parse HEAD^1") return `${control}\n`;
      if (operation.startsWith("diff --name-only "))
        return [
          "apps/web/src/server/providers/v208-soulx-qualification.ts",
          "deploy/v2-08/build-soulx-live-request.mjs",
          "scripts/tests/v2-08-build-soulx-live-request.test.mjs",
        ].join("\n");
      throw new Error("unexpected git call");
    });
    expect(() => assertV208ExecutionControlSource(control, runGit as never)).not.toThrow();
    runGit.mockImplementationOnce(() => " M deploy/v2-08/launch-soulx-live.mjs\n");
    expect(() => assertV208ExecutionControlSource(control, runGit as never)).toThrow(
      "V208_EXECUTION_SOURCE_DIRTY",
    );
    runGit.mockImplementation((_command: string, args: string[]) => {
      const operation = args.slice(2).join(" ");
      if (operation.startsWith("status ")) return "";
      if (operation === "rev-parse HEAD^{commit}") return `${"c".repeat(40)}\n`;
      if (operation === "rev-parse HEAD^1") return `${control}\n`;
      if (operation.startsWith("diff --name-only "))
        return "apps/web/src/server/providers/v208-soulx-qualification.ts\npackage.json\n";
      throw new Error("unexpected git call");
    });
    expect(() => assertV208ExecutionControlSource(control, runGit as never)).toThrow(
      "V208_AUTHORITY_MATERIALIZATION_SCOPE_INVALID",
    );
  });

  it("accepts NUL-bearing media and one launcher JSON newline", () => {
    const root = mkdtempSync(join(tmpdir(), "v208-fd-test-"));
    const binaryPath = join(root, "input.png");
    const textPath = join(root, "input.json");
    writeFileSync(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]));
    writeFileSync(textPath, '{"ok":true}\n');
    const binaryFd = openSync(binaryPath, "r");
    const textFd = openSync(textPath, "r");
    try {
      expect(readV208BinaryFd(String(binaryFd), "BINARY_INVALID")).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]),
      );
      expect(readV208TextFd(String(textFd), "TEXT_INVALID")).toBe('{"ok":true}');
    } finally {
      closeSync(binaryFd);
      closeSync(textFd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads and narrows the durable cleanup scope to the exact consumed SoulX authority", async () => {
    const stage = {
      stage: "soulx",
      stageAuthorityId: STAGE_AUTHORITY,
      operations: [
        {
          operationId: "create-op",
          stageAuthorityId: STAGE_AUTHORITY,
          kind: "create",
          resourceKey: RESOURCE_KEY,
          state: "ACKED",
          providerId: "endpoint-v208",
          evidence: {},
        },
        {
          operationId: "dispatch-op",
          stageAuthorityId: STAGE_AUTHORITY,
          kind: "dispatch",
          resourceKey: "v208-soulx-cold-whole-span-2-4-6-10s",
          state: "ACKED",
          providerId: "job-cold",
          evidence: null,
        },
        {
          operationId: "status-op",
          stageAuthorityId: STAGE_AUTHORITY,
          kind: "status",
          resourceKey: `sha256:${"a".repeat(64)}:job-cold:0`,
          state: "TERMINAL",
          providerId: "job-cold",
          evidence: {},
        },
        {
          operationId: "cancel-op",
          stageAuthorityId: STAGE_AUTHORITY,
          kind: "cancel",
          resourceKey: `sha256:${"a".repeat(64)}:job-cancel`,
          state: "TERMINAL",
          providerId: "job-cancel",
          evidence: {},
        },
        {
          operationId: "delete-op",
          stageAuthorityId: STAGE_AUTHORITY,
          kind: "delete",
          resourceKey: RESOURCE_KEY,
          state: "TERMINAL",
          providerId: "endpoint-v208",
          evidence: null,
        },
      ],
    };
    const store = durable({
      stageAuthority: {
        status: "CLAIMED",
        authority: { authorityId: STAGE_AUTHORITY },
        claim: { nonceSha256: `sha256:${"a".repeat(64)}`, consumedAt: "2026-01-01T00:00:00.000Z" },
        handoff: null,
      },
      operations: stage.operations,
    });
    const cleanupAttributableResources = vi.fn(async () => ({
      production: [],
      deletedEndpointIdSha256s: [],
      deletedTemplateIdSha256s: [],
    }));
    const cleanup = createV208CleanupAttributableResource({
      durable: store,
      transport: { cleanupAttributableResources },
    });

    await expect(cleanup(RESOURCE_KEY)).resolves.toBe(true);
    expect(store.readSnapshot).toHaveBeenCalledTimes(1);
    expect(cleanupAttributableResources).toHaveBeenCalledWith([
      expect.objectContaining({
        stage: "soulx",
        stageAuthorityId: STAGE_AUTHORITY,
        operations: stage.operations,
      }),
    ]);
  });

  it("rejects cleanup scope containing a different resource key", async () => {
    const cleanup = createV208CleanupAttributableResource({
      durable: durable({
        stageAuthority: {
          status: "CLAIMED",
          authority: { authorityId: STAGE_AUTHORITY },
          claim: {
            nonceSha256: `sha256:${"a".repeat(64)}`,
            consumedAt: "2026-01-01T00:00:00.000Z",
          },
          handoff: null,
        },
        operations: [
          {
            operationId: "bad-op",
            stageAuthorityId: STAGE_AUTHORITY,
            kind: "create",
            resourceKey: "v213-another-authority-soulx-qualification",
            state: "ACKED",
            providerId: "endpoint-v208",
            evidence: null,
          },
        ],
      }),
      transport: { cleanupAttributableResources: vi.fn() },
    });
    await expect(cleanup(RESOURCE_KEY)).rejects.toThrow("V208_CLEANUP_OPERATION_SCOPE_INVALID");
  });

  it("rejects a fresh journal or request id for the same proposal", () => {
    const proposal = `sha256:${"a".repeat(64)}`;
    const home = "/private/test-home";
    const requestId = `v208-${"a".repeat(64)}`;
    expect(() =>
      assertV208SingleUseJournalBinding(
        proposal,
        requestId,
        `${home}/.videoforge/v2-08/${requestId}`,
        home,
      ),
    ).not.toThrow();
    expect(() =>
      assertV208SingleUseJournalBinding(proposal, requestId, `${home}/fresh-journal`, home),
    ).toThrow("V208_SINGLE_USE_JOURNAL_BINDING_INVALID");
  });

  it("rejects null authority before loading the RunPod key", async () => {
    const loadRunPodKey = vi.fn(async () => "runpod-key-at-least-twenty-characters");
    const writeOutput = vi.fn();
    await expect(
      runV208SoulXLiveCli(process.env, {
        loadRunPodKey,
        readInputs: () => ({}) as never,
        createComposition: (() => ({ dependencies: {} })) as never,
        writeOutput,
      }),
    ).rejects.toThrow("V208_FRESH_EXACT_AUTHORITY_REQUIRED");
    expect(loadRunPodKey).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
  });
});
