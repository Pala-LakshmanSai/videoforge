import { describe, expect, it } from "vitest";

import { safeAvatarFailureEvidence } from "./runpod-avatar-result";

describe("safeAvatarFailureEvidence", () => {
  it("retains only a stable code and diagnostic digest", () => {
    expect(
      safeAvatarFailureEvidence({
        ok: false,
        error_code: "AVATAR_INFERENCE_CUDA_OOM",
        diagnostic_sha256: `sha256:${"a".repeat(64)}`,
        raw_stderr: "must not cross the boundary",
      }),
    ).toEqual({
      error_code: "AVATAR_INFERENCE_CUDA_OOM",
      diagnostic_sha256: `sha256:${"a".repeat(64)}`,
    });
  });

  it("rejects malformed or unrestricted failure envelopes", () => {
    expect(
      safeAvatarFailureEvidence({
        ok: false,
        error_code: "raw traceback",
        diagnostic_sha256: "not-a-digest",
      }),
    ).toBeNull();
  });
});
