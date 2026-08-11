import { describe, expect, it, vi } from "vitest";

import { createRunwareRuntime, isRunwareRuntimeRequested } from "./runware-runtime";

vi.mock("./keychain", () => ({
  loadRunwareApiKeyFromKeychain: vi.fn(async () => "runware-test-key-at-least-twenty-characters"),
}));

describe("Runware runtime composition", () => {
  it("leaves fixture and ordinary sandbox provider-free", async () => {
    expect(isRunwareRuntimeRequested({ VIDEOFORGE_PROVIDER_MODE: "fixture" })).toBe(false);
    await expect(
      createRunwareRuntime({ VIDEOFORGE_PROVIDER_MODE: "sandbox" }, { record: vi.fn() }),
    ).resolves.toBeNull();
  });

  it("fails closed unless exact sandbox authority and cap are present", () => {
    for (const source of [
      {
        VIDEOFORGE_PROVIDER_MODE: "fixture",
        VIDEOFORGE_RUNWARE_ENABLED: "true",
        VIDEOFORGE_RUNWARE_CAP_USD: "0.20",
      },
      { VIDEOFORGE_PROVIDER_MODE: "sandbox", VIDEOFORGE_RUNWARE_ENABLED: "true" },
      {
        VIDEOFORGE_PROVIDER_MODE: "sandbox",
        VIDEOFORGE_RUNWARE_ENABLED: "true",
        VIDEOFORGE_RUNWARE_CAP_USD: "1.00",
      },
    ]) {
      expect(() => isRunwareRuntimeRequested(source)).toThrow("RUNWARE_RUNTIME_AUTHORITY_INVALID");
    }
  });

  it("creates both locked roles behind one combined ledger", async () => {
    const runtime = await createRunwareRuntime(
      {
        VIDEOFORGE_PROVIDER_MODE: "sandbox",
        VIDEOFORGE_RUNWARE_ENABLED: "true",
        VIDEOFORGE_RUNWARE_CAP_USD: "0.20",
      },
      { record: vi.fn() },
    );
    expect(runtime?.ledger.snapshot()).toEqual({
      capUsd: 0.2,
      reservedUsd: 0,
      settledUsd: 0,
      remainingUsd: 0.2,
    });
    expect(runtime?.promptWriter).toBeDefined();
    expect(runtime?.createStyleAnalyzer).toBeTypeOf("function");
  });
});
