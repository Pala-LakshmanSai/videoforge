#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { FORBIDDEN_SECRET_NAMES, REQUIRED_SECRET_NAMES, SECRET_POLICY } from "./secret-policy.mjs";

const expected = new Set(REQUIRED_SECRET_NAMES);
const forbidden = new Set(FORBIDDEN_SECRET_NAMES);

const input = process.argv[2];
if (!input) throw new Error("secret list JSON path is required");
const rows = JSON.parse(await readFile(input, "utf8"));
if (!Array.isArray(rows)) throw new Error("secret list must be a JSON array");
const names = rows.map((row) => row?.name);
if (names.some((name) => typeof name !== "string"))
  throw new Error("secret list has a malformed name");
const actual = new Set(names);
if (actual.size !== names.length) throw new Error("secret list contains duplicate names");
if (actual.size !== expected.size || [...expected].some((name) => !actual.has(name)))
  throw new Error("remote Worker secret list is not the exact V2-06 allowlist");
if (names.some((name) => forbidden.has(name)))
  throw new Error("remote Worker secret list contains a currently forbidden V2-06 secret");
console.log(
  JSON.stringify({
    count: actual.size,
    names: [...actual].sort(),
    policy: SECRET_POLICY.schema_version,
  }),
);
