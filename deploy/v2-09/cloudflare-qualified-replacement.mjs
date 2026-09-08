import { SECRET_NAMES } from "../v2-13/guarded-activation.mjs";
import { createHash } from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createV209CloudflareReplacementCapabilities } from "./cloudflare-production-operator.mjs";
const canonical = (v) =>
  Array.isArray(v)
    ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
const hash = (v) =>
  "sha256:" +
  createHash("sha256")
    .update(typeof v === "string" ? v : canonical(v))
    .digest("hex");
const HASH = /^sha256:[a-f0-9]{64}$/u,
  COMMIT = /^[a-f0-9]{40}$/u,
  UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const fail = (code) => {
  throw Error("V2_09_QUALIFIED_REPLACEMENT_" + code);
};
export function createV209CloudflareQualifiedReplacement(
  { configuration, authority, predecessor },
  dependencies = {},
) {
  if (
    Object.keys(dependencies).some((k) => !["testOnly", "capabilities"].includes(k)) ||
    (dependencies.capabilities && dependencies.testOnly !== true)
  )
    fail("INJECTION");
  if (
    !predecessor ||
    Object.keys(predecessor).sort().join(",") !==
      [
        "versionId",
        "sourceCommit",
        "qualifiedConfigPath",
        "qualifiedConfigSha256",
        "workerBundleSha256",
      ]
        .sort()
        .join(",") ||
    !UUID.test(predecessor.versionId) ||
    !COMMIT.test(predecessor.sourceCommit) ||
    ![predecessor.qualifiedConfigSha256, predecessor.workerBundleSha256].every((x) =>
      HASH.test(x),
    ) ||
    resolve(predecessor.qualifiedConfigPath) !== predecessor.qualifiedConfigPath ||
    authority.replacement_predecessor_sha256 !== hash(predecessor) ||
    authority.source_commit === predecessor.sourceCommit ||
    authority.single_use !== true ||
    authority.production?.secret_count !== SECRET_NAMES.length ||
    authority.caps?.max_incremental_usd !== 2 ||
    authority.caps?.max_completion_usd !== 17.5
  )
    fail("BINDING");
  const path = configuration.journalPath;
  if (resolve(path) !== path) fail("PATH");
  const dir = lstatSync(dirname(path));
  if (
    !dir.isDirectory() ||
    dir.isSymbolicLink() ||
    dir.uid !== process.getuid() ||
    (dir.mode & 63) !== 0
  )
    fail("PARENT");
  const ports =
    dependencies.capabilities ?? createV209CloudflareReplacementCapabilities(configuration);
  const authorityHash = hash(authority);
  let busy = false;
  const locked = async (fn) => {
    if (busy) fail("BUSY");
    busy = true;
    let fd;
    try {
      try {
        fd = openSync(path + ".lock", "wx", 0o600);
      } catch {
        fail("LOCKED");
      }
      return await fn();
    } finally {
      if (fd !== undefined) {
        closeSync(fd);
        unlinkSync(path + ".lock");
      }
      busy = false;
    }
  };
  const read = () => {
    let fd;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const st = fstatSync(fd);
      if (
        !st.isFile() ||
        st.nlink !== 1 ||
        st.uid !== process.getuid() ||
        (st.mode & 511) !== 384 ||
        st.size > 1048576
      )
        fail("JOURNAL_PRIVATE");
      const j = JSON.parse(readFileSync(fd, "utf8"));
      if (
        j.schema_version !== "videoforge.v2-09-qualified-replacement-journal/v1" ||
        j.authority_sha256 !== authorityHash
      )
        fail("JOURNAL_BINDING");
      return j;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  const save = (j, first = false) => {
    const target = first ? path : path + ".next";
    let fd;
    try {
      fd = openSync(target, "wx", 0o600);
      writeFileSync(fd, canonical(j) + "\n");
      fsyncSync(fd);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    if (!first) renameSync(target, path);
    const d = openSync(dirname(path), "r");
    try {
      fsyncSync(d);
    } finally {
      closeSync(d);
    }
  };
  const current = () => {
    ports.assertAuthority(authority);
    return read();
  };
  return Object.freeze({
    verifyPredecessor: () =>
      locked(async () => {
        ports.assertAuthority(authority);
        let fd;
        try {
          fd = openSync(predecessor.qualifiedConfigPath, constants.O_RDONLY | constants.O_NOFOLLOW);
          const st = fstatSync(fd);
          if (!st.isFile() || st.nlink !== 1) fail("PREDECESSOR_FILE");
          if (hash(readFileSync(fd, "utf8")) !== predecessor.qualifiedConfigSha256)
            fail("PREDECESSOR_HASH");
        } finally {
          if (fd !== undefined) closeSync(fd);
        }
        // Exclusive claim is durable before provider reads; no existing journal is ever adopted.
        const j = {
          schema_version: "videoforge.v2-09-qualified-replacement-journal/v1",
          authority_sha256: authorityHash,
          predecessor_sha256: hash(predecessor),
          state: "CLAIMED",
          events: [],
          inherited_secret_count: SECRET_NAMES.length,
          introduced_secret_names: [],
          retained_r2_deleted: false,
        };
        save(j, true);
        const version = await ports.predecessor(authority, predecessor);
        j.state = "PREDECESSOR_VERIFIED";
        j.predecessor_version_sha256 = version.versionIdSha256;
        save(j);
        return version;
      }),
    deployOnce: () =>
      locked(async () => {
        const j = current();
        if (j.state !== "PREDECESSOR_VERIFIED") fail("DEPLOY_REPLAY");
        const artifact = await ports.prepare(authority);
        try {
          await ports.predecessor(authority, predecessor);
          j.state = "DEPLOY_INTENT";
          j.events.push({ kind: "QUALIFIED_DEPLOY", status: "INTENT" });
          save(j);
          try {
            await ports.deploy(authority, artifact);
            j.events.push({ kind: "QUALIFIED_DEPLOY", status: "COMMITTED" });
            j.state = "DEPLOY_COMMITTED";
            save(j);
          } catch (error) {
            j.state = "DEPLOY_UNKNOWN";
            j.events.push({ kind: "QUALIFIED_DEPLOY", status: "UNKNOWN" });
            save(j);
            throw error;
          }
          const version = await ports.readback(authority, "DISABLED_UNQUALIFIED");
          j.state = "QUALIFIED_DISABLED_VERIFIED";
          j.version = version;
          save(j);
          return version;
        } finally {
          artifact.cleanup();
        }
      }),
    readbackEffective: () =>
      locked(async () => {
        const j = current();
        if (j.state !== "QUALIFIED_DISABLED_VERIFIED") fail("READBACK_STATE");
        const version = await ports.readback(authority, "QUALIFIED_EXACT");
        if (version.versionId !== j.version.versionId) fail("VERSION_DRIFT");
        j.state = "QUALIFIED_EFFECTIVE_VERIFIED";
        save(j);
        return version;
      }),
    containFailure: () =>
      locked(async () => {
        ports.assertCleanupAuthority(authority);
        const j = read();
        if (
          ![
            "DEPLOY_INTENT",
            "DEPLOY_UNKNOWN",
            "DEPLOY_COMMITTED",
            "QUALIFIED_DISABLED_VERIFIED",
            "QUALIFIED_EFFECTIVE_VERIFIED",
          ].includes(j.state)
        )
          fail("CLEANUP_REPLAY_OR_STATE");
        j.state = "DISABLE_INTENT";
        j.events.push({ kind: "DISABLED_DEPLOY", status: "INTENT" });
        save(j);
        try {
          const version = await ports.disable(authority);
          j.state = "SAFE_DISABLED_INHERITED_SECRETS_RETAINED";
          j.version = version;
          j.events.push({ kind: "DISABLED_DEPLOY", status: "COMMITTED" });
          save(j);
          return version;
        } catch (error) {
          j.state = "DISABLE_UNKNOWN";
          j.events.push({ kind: "DISABLED_DEPLOY", status: "UNKNOWN" });
          save(j);
          throw error;
        }
      }),
    read,
  });
}
