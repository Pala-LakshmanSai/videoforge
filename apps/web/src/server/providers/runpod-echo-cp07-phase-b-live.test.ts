import { describe, expect, it } from "vitest";

import {
  assertCp07ReplacementInventory,
  CP06_MAGE_VOLUME_ID_HASH,
  CP07_INVALID_ECHO_VOLUME_ID_HASH,
  CP07_REGION,
  CP07_VOLUME_NAME,
} from "./runpod-echo-cp07-phase-b-live";

const exactVolumes = () =>
  [
    {
      idHash: CP06_MAGE_VOLUME_ID_HASH,
      name: "videoforge-mage-cp06-model-volume-eu-ro-1-50gb",
      size: 50,
      dataCenterId: CP07_REGION,
    },
    {
      idHash: CP07_INVALID_ECHO_VOLUME_ID_HASH,
      name: CP07_VOLUME_NAME,
      size: 50,
      dataCenterId: CP07_REGION,
    },
  ] as const;

describe("CP-07 invalid Echo volume replacement boundary", () => {
  it("selects only the exact retained invalid Echo volume beside the exact Mage volume", () => {
    expect(assertCp07ReplacementInventory(exactVolumes())).toBe(CP07_INVALID_ECHO_VOLUME_ID_HASH);
  });

  it.each([
    ["missing Echo", exactVolumes().slice(0, 1)],
    ["extra volume", [...exactVolumes(), exactVolumes()[1]]],
    [
      "foreign Echo hash",
      [
        { ...exactVolumes()[0] },
        {
          ...exactVolumes()[1],
          idHash: `sha256:${"f".repeat(64)}` as `sha256:${string}`,
        },
      ],
    ],
    ["wrong size", [{ ...exactVolumes()[0] }, { ...exactVolumes()[1], size: 51 }]],
    ["wrong region", [{ ...exactVolumes()[0] }, { ...exactVolumes()[1], dataCenterId: "EU-SE-1" }]],
  ])("rejects %s", (_label, volumes) => {
    expect(() => assertCp07ReplacementInventory(volumes)).toThrow(
      "CP07_REPLACEMENT_VOLUME_INVENTORY_MISMATCH",
    );
  });
});
