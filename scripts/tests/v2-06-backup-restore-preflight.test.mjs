import assert from "node:assert/strict";
import { constants as fsConstants } from "node:fs";
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HASH_COMMANDS,
  PRIVATE_INPUTS,
  REQUIRED_COMMANDS,
  bootstrapPrivateInputs,
  inspectPrivateInputs,
  inspectToolchain,
} from "../../deploy/v2-06/backup-restore-preflight.mjs";

const temporaryDirectory = (prefix) => mkdtemp(path.join(tmpdir(), prefix));

test("backup/restore preflight reports missing PATH dependencies without executing provider clients", async () => {
  const result = await inspectToolchain({ PATH: "" });
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes("pg_dump"));
  assert.ok(result.missing.includes("psql"));
  assert.ok(result.missing.includes("openssl"));
});

test("backup/restore preflight accepts a complete local executable PATH", async () => {
  const root = await temporaryDirectory("videoforge-v2-06-tools-");
  try {
    for (const command of [...REQUIRED_COMMANDS, HASH_COMMANDS[0]]) {
      const executable = path.join(root, command);
      await writeFile(executable, "", { mode: 0o700 });
      await chmod(executable, 0o700);
      assert.equal((await lstat(executable)).mode & fsConstants.S_IFMT, fsConstants.S_IFREG);
    }
    const result = await inspectToolchain({ PATH: root });
    assert.equal(result.ready, true);
    assert.deepEqual(result.missing, []);
    assert.equal(result.selected_hash_command, HASH_COMMANDS[0]);
    const restoreOnly = await inspectToolchain({ PATH: root }, "restore");
    assert.equal(restoreOnly.ready, true);
    assert.equal(restoreOnly.commands.pg_dump, undefined);
    assert.deepEqual(restoreOnly.hash_commands, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrap creates only empty private placeholders with safe metadata", async () => {
  const root = await temporaryDirectory("videoforge-v2-06-inputs-");
  const directory = path.join(root, "postgres-inputs");
  try {
    const result = await bootstrapPrivateInputs(directory);
    assert.equal(result.created_directory, true);
    assert.deepEqual(
      result.created,
      PRIVATE_INPUTS.map(({ name }) => name),
    );
    assert.equal(result.inputs.ready, false);
    assert.ok(result.inputs.files.every(({ state }) => state === "empty_placeholder"));

    const directoryMetadata = await lstat(directory);
    assert.equal(directoryMetadata.mode & 0o777, 0o700);
    for (const { name } of PRIVATE_INPUTS) {
      const metadata = await lstat(path.join(directory, name));
      assert.equal(metadata.mode & 0o777, 0o600);
      assert.equal(metadata.size, 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrap preserves populated private input metadata without overwriting it", async () => {
  const root = await temporaryDirectory("videoforge-v2-06-preserve-");
  const directory = path.join(root, "postgres-inputs");
  const sentinel = Buffer.from("fixture-only-private-input");
  try {
    await mkdir(directory, { mode: 0o700 });
    await chmod(directory, 0o700);
    const existing = path.join(directory, PRIVATE_INPUTS[2].name);
    await writeFile(existing, sentinel, { mode: 0o600 });
    await chmod(existing, 0o600);
    const result = await bootstrapPrivateInputs(directory);
    assert.deepEqual(result.created, [PRIVATE_INPUTS[0].name, PRIVATE_INPUTS[1].name]);
    assert.equal(result.inputs.files[2].state, "populated_without_reading");
    assert.equal((await lstat(existing)).size, sentinel.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrap rejects unexpected entries and unsafe symlink inputs before creating placeholders", async () => {
  const root = await temporaryDirectory("videoforge-v2-06-reject-");
  const directory = path.join(root, "postgres-inputs");
  try {
    await mkdir(directory, { mode: 0o700 });
    await chmod(directory, 0o700);
    const unexpected = path.join(directory, "unexpected.txt");
    await writeFile(unexpected, "not an input", { mode: 0o600 });
    await chmod(unexpected, 0o600);
    await assert.rejects(() => bootstrapPrivateInputs(directory), /unexpected entries/u);
    assert.equal((await inspectPrivateInputs(directory)).files.length, PRIVATE_INPUTS.length);
    await rm(unexpected);
    await symlink(path.join(root, "outside"), path.join(directory, PRIVATE_INPUTS[0].name));
    await assert.rejects(() => bootstrapPrivateInputs(directory), /not safe to preserve/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflight source does not require or expose private input contents", async () => {
  const source = await readFile(
    new URL("../../deploy/v2-06/backup-restore-preflight.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /populated_without_reading/u);
  assert.doesNotMatch(source, /readFile/gu);
  assert.doesNotMatch(source, /spawn|execFile|fetch\(/gu);
  assert.match(source, /provider_calls: false/u);
  assert.match(source, /remote_mutation: false/u);
});
