import { createHash } from "node:crypto";

import { canonicalizeJson, type Sha256Digest } from "@videoforge/contracts";

export const hashUtf8 = (value: string): Sha256Digest =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

export const hashCanonical = (value: unknown): Sha256Digest => hashUtf8(canonicalizeJson(value));
