#!/usr/bin/env node

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const MAGIC = Buffer.from("V2-06-ENCRYPTED-BACKUP/v1\n", "utf8");
const TAG_PREFIX = Buffer.from("hmac-sha256:", "utf8");
const TAG_LENGTH = 64;
const PREFIX_LENGTH = MAGIC.length + TAG_PREFIX.length + TAG_LENGTH + 1;

const fail = (message) => {
  throw new Error(`V2-06 backup envelope: ${message}`);
};

const requirePrivateFile = async (file, label) => {
  let metadata;
  try {
    metadata = await lstat(file);
  } catch {
    fail(`${label} is not readable`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600)
    fail(`${label} must be a regular mode-0600 file`);
  return metadata;
};

const passphrase = async (file) => {
  await requirePrivateFile(file, "passphrase file");
  const bytes = await readFile(file);
  if (
    !bytes.length ||
    bytes.subarray(0, bytes.indexOf(0x0a) === -1 ? bytes.length : bytes.indexOf(0x0a)).length === 0
  )
    fail("passphrase file must have a non-empty first line");
  return bytes;
};

const hmacFile = async (file, key, start = 0) => {
  const hmac = createHmac("sha256", key);
  for await (const chunk of createReadStream(file, { start })) hmac.update(chunk);
  return hmac.digest();
};

const readPrefix = async (file) => {
  const metadata = await requirePrivateFile(file, "backup file");
  if (metadata.size <= PREFIX_LENGTH) fail("backup envelope is truncated");
  const handle = await open(file, "r");
  const prefix = Buffer.alloc(PREFIX_LENGTH);
  try {
    const { bytesRead } = await handle.read(prefix, 0, PREFIX_LENGTH, 0);
    if (bytesRead !== PREFIX_LENGTH) fail("backup envelope prefix is truncated");
  } finally {
    await handle.close();
  }
  if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) fail("unsupported backup envelope version");
  const tagStart = MAGIC.length;
  const tagEnd = tagStart + TAG_PREFIX.length;
  if (!prefix.subarray(tagStart, tagEnd).equals(TAG_PREFIX)) fail("backup envelope MAC is missing");
  const tagText = prefix.subarray(tagEnd, tagEnd + TAG_LENGTH).toString("ascii");
  if (!/^[0-9a-f]{64}$/u.test(tagText) || prefix[PREFIX_LENGTH - 1] !== 0x0a)
    fail("backup envelope MAC is malformed");
  return { metadata, expectedTag: Buffer.from(tagText, "hex"), payloadStart: PREFIX_LENGTH };
};

const packEnvelope = async (ciphertextFile, outputFile, passphraseFile) => {
  await requirePrivateFile(ciphertextFile, "encrypted backup");
  const key = await passphrase(passphraseFile);
  const tag = await hmacFile(ciphertextFile, key);
  const output = createWriteStream(outputFile, { flags: "w", mode: 0o600 });
  output.write(
    Buffer.concat([
      MAGIC,
      TAG_PREFIX,
      Buffer.from(tag.toString("hex"), "ascii"),
      Buffer.from("\n"),
    ]),
  );
  await pipeline(createReadStream(ciphertextFile), output);
};

const unpackEnvelope = async (inputFile, ciphertextFile, passphraseFile) => {
  const { expectedTag, payloadStart } = await readPrefix(inputFile);
  const key = await passphrase(passphraseFile);
  const actualTag = await hmacFile(inputFile, key, payloadStart);
  if (actualTag.length !== expectedTag.length || !timingSafeEqual(actualTag, expectedTag))
    fail("backup envelope integrity check failed");
  const output = createWriteStream(ciphertextFile, { flags: "w", mode: 0o600 });
  await pipeline(createReadStream(inputFile, { start: payloadStart }), output);
  await requirePrivateFile(ciphertextFile, "verified encrypted backup");
};

const main = async () => {
  const [operation, inputFile, outputFile, passphraseFile] = process.argv.slice(2);
  if (!operation || !inputFile || !outputFile || !passphraseFile)
    fail("usage: backup-envelope.mjs <pack|unpack> <input> <output> <passphrase-file>");
  if (operation === "pack") await packEnvelope(inputFile, outputFile, passphraseFile);
  else if (operation === "unpack") await unpackEnvelope(inputFile, outputFile, passphraseFile);
  else fail(`unsupported operation ${operation}`);
  console.log(JSON.stringify({ operation, integrity: "hmac-sha256" }));
};

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export { MAGIC, packEnvelope, unpackEnvelope };
