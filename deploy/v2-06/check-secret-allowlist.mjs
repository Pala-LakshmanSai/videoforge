#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const expected = new Set([
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "WORKFLOW_CALLBACK_SECRET",
  "MEDIA_WORKER_TOKEN_SECRET",
]);

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
if (names.some((name) => name.startsWith("EMAIL_")))
  throw new Error("email delivery secrets are forbidden for V2-06");
console.log(JSON.stringify({ count: actual.size, names: [...actual].sort() }));
