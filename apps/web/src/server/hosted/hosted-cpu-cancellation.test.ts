import { describe, expect, it } from "vitest";

import { exactHostedCpuCancellationConfirmation } from "./hosted-cpu-cancellation";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

describe("hosted CPU cancellation confirmation", () => {
  it("accepts only the exact attempt-bound confirmation", () => {
    expect(
      exactHostedCpuCancellationConfirmation(
        {
          schema_version: "videoforge-hosted-cpu-cancellation/v1",
          attempt_id: ATTEMPT_ID,
          confirmation: "STOP",
        },
        ATTEMPT_ID,
      ),
    ).toBe(true);
  });

  it.each([
    {},
    null,
    {
      schema_version: "videoforge-hosted-cpu-cancellation/v1",
      attempt_id: ATTEMPT_ID,
      confirmation: "",
    },
    {
      schema_version: "videoforge-hosted-cpu-cancellation/v1",
      attempt_id: "22222222-2222-4222-8222-222222222222",
      confirmation: "STOP",
    },
    {
      schema_version: "videoforge-hosted-cpu-cancellation/v1",
      attempt_id: ATTEMPT_ID,
      confirmation: "STOP",
      extra: true,
    },
  ])("rejects an unconfirmed or mismatched cancellation body", (value) => {
    expect(exactHostedCpuCancellationConfirmation(value, ATTEMPT_ID)).toBe(false);
  });
});
