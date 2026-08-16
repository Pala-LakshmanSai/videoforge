export type ServerlessBatchItemState = "PENDING" | "ACCEPTED" | "FAILED" | "CARRIED_FORWARD";

export interface ServerlessBatchItem {
  readonly itemId: string;
  readonly inputSha256: string;
  readonly outputObjectKey: string;
  readonly state: ServerlessBatchItemState;
}

export class ServerlessBatchError extends Error {
  constructor(
    readonly code:
      | "BATCH_DUPLICATE_ITEM"
      | "BATCH_EMPTY_REPLACEMENT"
      | "BATCH_ITEM_ID_INVALID"
      | "BATCH_TERMINAL_ITEM_REGENERATED",
    message: string,
  ) {
    super(message);
    this.name = "ServerlessBatchError";
  }
}

/**
 * Builds the one bounded replacement batch after a prior attempt is terminal. Canonically accepted
 * units are omitted; only unresolved units carry forward. This contract does not promise the
 * provider avoided duplicate execution—it prevents VideoForge from intentionally regenerating an
 * already accepted unit during resume.
 */
export function buildAcceptedUnitResumeBatch(
  priorItems: readonly ServerlessBatchItem[],
): readonly ServerlessBatchItem[] {
  const seen = new Set<string>();
  const replacement: ServerlessBatchItem[] = [];
  for (const item of priorItems) {
    if (item.itemId.length === 0) {
      throw new ServerlessBatchError("BATCH_ITEM_ID_INVALID", "Every lane item needs an exact id.");
    }
    if (seen.has(item.itemId)) {
      throw new ServerlessBatchError(
        "BATCH_DUPLICATE_ITEM",
        `Lane item ${item.itemId} appears more than once.`,
      );
    }
    seen.add(item.itemId);
    if (item.state === "ACCEPTED") continue;
    if (item.state === "CARRIED_FORWARD") {
      throw new ServerlessBatchError(
        "BATCH_TERMINAL_ITEM_REGENERATED",
        "A carried-forward item must be resolved in its replacement attempt before another resume.",
      );
    }
    replacement.push(Object.freeze({ ...item, state: "CARRIED_FORWARD" }));
  }
  if (replacement.length === 0) {
    throw new ServerlessBatchError(
      "BATCH_EMPTY_REPLACEMENT",
      "A fully accepted lane has nothing to redispatch.",
    );
  }
  return Object.freeze(replacement);
}
