import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import {
  V209_REAL_CHROME_CLAIM_SCHEMA,
  V209_REAL_CHROME_CLICK_IDENTITY_SCHEMA,
  V209_REAL_CHROME_CREATE_REQUEST_IDENTITY_SCHEMA,
  V209_REAL_CHROME_PROJECT_IDENTITY_SCHEMA,
  V209_REAL_CHROME_REQUEST_SCHEMA,
  V209_REAL_CHROME_SOURCE,
  type V209GenerateClickClaimPort,
} from "../../apps/web/src/server/providers/v209-real-chrome-operator.js";
import { runV209RealChromePlaywright } from "../../apps/web/src/server/providers/v209-real-chrome-playwright.js";

const SCHEMA = "videoforge.v2-09-real-chrome-bridge/v1";
const RESULT_SCHEMA = "videoforge.v2-09-real-chrome-bridge-result/v1";
const AUTHORITY = /^v2-09-[a-z0-9][a-z0-9._-]{7,95}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const CLAIM_FILE_SCHEMA = "videoforge.v2-09-click-claim-file/v1";
const CREATE_FILE_SCHEMA = "videoforge.v2-09-click-create-request-file/v1";
const PROJECT_FILE_SCHEMA = "videoforge.v2-09-click-project-identity-file/v1";
const IDENTITY_FILE_SCHEMA = "videoforge.v2-09-click-generation-identity-file/v1";

function fail(code: string): never {
  throw new Error(code);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail("V2_09_REAL_CHROME_CLICK_IDENTITY_INVALID");
  return encoded;
}

function assertPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.nlink < 1 ||
    (stat.mode & 0o777) !== 0o700 ||
    (uid !== undefined && stat.uid !== uid)
  )
    fail("V2_09_REAL_CHROME_CLICK_IDENTITY_PATH_INVALID");
}

function writeClickIdentity(path: string, value: unknown): void {
  if (!isAbsolute(path)) fail("V2_09_REAL_CHROME_CLICK_IDENTITY_PATH_INVALID");
  const parent = dirname(path);
  assertPrivateDirectory(parent);
  const bytes = Buffer.from(`${canonical(value)}\n`, "utf8");
  let file = -1;
  try {
    file = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    const stat = fstatSync(file);
    const uid = process.getuid?.();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== 0o600 ||
      (uid !== undefined && stat.uid !== uid)
    )
      fail("V2_09_REAL_CHROME_CLICK_IDENTITY_PATH_INVALID");
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(file, bytes, offset, bytes.length - offset);
      if (written <= 0) fail("V2_09_REAL_CHROME_CLICK_IDENTITY_PERSIST_FAILED");
      offset += written;
    }
    fsyncSync(file);
  } catch {
    fail("V2_09_REAL_CHROME_CLICK_IDENTITY_PERSIST_FAILED");
  } finally {
    if (file >= 0) closeSync(file);
  }
  let directory = -1;
  try {
    directory = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    fsyncSync(directory);
  } catch {
    fail("V2_09_REAL_CHROME_CLICK_IDENTITY_PERSIST_FAILED");
  } finally {
    if (directory >= 0) closeSync(directory);
  }
}

function record(
  value: unknown,
  code = "V2_09_REAL_CHROME_BRIDGE_INPUT_INVALID",
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

export async function runV209RealChromeBridge(
  value: unknown,
  dependencies: Readonly<{ runPlaywright?: typeof runV209RealChromePlaywright }> = {},
) {
  const input = record(value);
  if (
    Object.keys(input).sort().join(",") !==
      [
        "authStatePath",
        "authorityId",
        "clickIdentityPath",
        "productionOrigin",
        "request",
        "schemaVersion",
        "verifiedOutputPath",
        "voiceoverPath",
      ]
        .sort()
        .join(",") ||
    input.schemaVersion !== SCHEMA ||
    typeof input.authorityId !== "string" ||
    !AUTHORITY.test(input.authorityId) ||
    typeof input.productionOrigin !== "string" ||
    typeof input.authStatePath !== "string" ||
    typeof input.clickIdentityPath !== "string" ||
    typeof input.verifiedOutputPath !== "string" ||
    typeof input.voiceoverPath !== "string"
  )
    fail("V2_09_REAL_CHROME_BRIDGE_INPUT_INVALID");
  const clickIdentityPath = input.clickIdentityPath;
  const claimPath = `${clickIdentityPath}.claim.json`;
  const createRequestPath = `${clickIdentityPath}.create-request.json`;
  const projectIdentityPath = `${clickIdentityPath}.project.json`;
  const request = record(input.request);
  if (
    request.schemaVersion !== V209_REAL_CHROME_REQUEST_SCHEMA ||
    request.source !== V209_REAL_CHROME_SOURCE
  )
    fail("V2_09_REAL_CHROME_BRIDGE_INPUT_INVALID");
  const requestSha256 = sha256(canonical(request));
  const claimId = sha256(`${input.authorityId}:${requestSha256}`);
  const prepared = record(request.prepared);
  if (!HASH.test(String(prepared.voiceoverSha256))) fail("V2_09_REAL_CHROME_BRIDGE_INPUT_INVALID");
  let claimPersisted = false;
  let createIdentity: Readonly<Record<string, unknown>> | undefined;
  let projectIdentity: Readonly<Record<string, unknown>> | undefined;
  let persistedIdentity: Readonly<Record<string, unknown>> | undefined;
  const claims: V209GenerateClickClaimPort = {
    reserveOneShot: async ({ source, accountId, workspaceId, prepared: observedPrepared }) => {
      if (
        claimPersisted ||
        source !== request.source ||
        accountId !== request.accountId ||
        workspaceId !== request.workspaceId ||
        canonical(observedPrepared) !== canonical(prepared)
      )
        fail("V2_09_REAL_CHROME_CLICK_CLAIM_INVALID");
      const claim = Object.freeze({
        schemaVersion: V209_REAL_CHROME_CLAIM_SCHEMA,
        claimId,
        source,
        accountId,
        workspaceId,
        prepared: observedPrepared,
        state: "RESERVED" as const,
        durable: true as const,
        replayed: false as const,
        priorClickCount: 0 as const,
        clickOrdinal: 1 as const,
      });
      writeClickIdentity(claimPath, {
        schema_version: CLAIM_FILE_SCHEMA,
        authority_id: input.authorityId,
        request_sha256: requestSha256,
        claim: {
          claimId,
          source,
          accountId,
          workspaceId,
          clickOrdinal: 1,
          voiceoverSha256: prepared.voiceoverSha256,
        },
      });
      claimPersisted = true;
      return claim;
    },
    recordCreateRequest: async (value) => {
      const identity = record(value, "V2_09_REAL_CHROME_CREATE_REQUEST_IDENTITY_INVALID");
      const keys = [
        "accountId",
        "claimId",
        "clickOrdinal",
        "createRequestSha256",
        "idempotencyKey",
        "schemaVersion",
        "source",
        "voiceoverSha256",
        "workspaceId",
      ];
      if (
        !claimPersisted ||
        createIdentity !== undefined ||
        Object.keys(identity).sort().join(",") !== keys.sort().join(",") ||
        identity.schemaVersion !== V209_REAL_CHROME_CREATE_REQUEST_IDENTITY_SCHEMA ||
        identity.source !== request.source ||
        identity.accountId !== request.accountId ||
        identity.workspaceId !== request.workspaceId ||
        identity.claimId !== claimId ||
        identity.clickOrdinal !== 1 ||
        !IDENTIFIER.test(String(identity.idempotencyKey)) ||
        !HASH.test(String(identity.createRequestSha256)) ||
        identity.voiceoverSha256 !== prepared.voiceoverSha256
      )
        fail("V2_09_REAL_CHROME_CREATE_REQUEST_IDENTITY_INVALID");
      const document = Object.freeze({
        schema_version: CREATE_FILE_SCHEMA,
        authority_id: input.authorityId,
        request_sha256: requestSha256,
        identity: Object.freeze({ ...identity }),
      });
      writeClickIdentity(createRequestPath, document);
      createIdentity = document.identity;
    },
    recordProjectIdentity: async (value) => {
      const identity = record(value, "V2_09_REAL_CHROME_PROJECT_IDENTITY_INVALID");
      const keys = [
        "accountId",
        "claimId",
        "clickOrdinal",
        "createRequestSha256",
        "generationRequestId",
        "idempotencyKey",
        "projectId",
        "projectRevisionId",
        "schemaVersion",
        "source",
        "voiceoverSha256",
        "workspaceId",
      ];
      if (
        createIdentity === undefined ||
        projectIdentity !== undefined ||
        Object.keys(identity).sort().join(",") !== keys.sort().join(",") ||
        identity.schemaVersion !== V209_REAL_CHROME_PROJECT_IDENTITY_SCHEMA ||
        identity.source !== createIdentity.source ||
        identity.accountId !== createIdentity.accountId ||
        identity.workspaceId !== createIdentity.workspaceId ||
        identity.claimId !== createIdentity.claimId ||
        identity.clickOrdinal !== 1 ||
        identity.idempotencyKey !== createIdentity.idempotencyKey ||
        identity.createRequestSha256 !== createIdentity.createRequestSha256 ||
        identity.voiceoverSha256 !== createIdentity.voiceoverSha256 ||
        !IDENTIFIER.test(String(identity.projectId)) ||
        !IDENTIFIER.test(String(identity.projectRevisionId)) ||
        identity.generationRequestId !== null
      )
        fail("V2_09_REAL_CHROME_PROJECT_IDENTITY_INVALID");
      const document = Object.freeze({
        schema_version: PROJECT_FILE_SCHEMA,
        authority_id: input.authorityId,
        request_sha256: requestSha256,
        lookup: Object.freeze({
          idempotencyKey: identity.idempotencyKey,
          createRequestSha256: identity.createRequestSha256,
        }),
        identity: Object.freeze({ ...identity }),
      });
      writeClickIdentity(projectIdentityPath, document);
      projectIdentity = document.identity;
    },
    recordAcknowledgedClick: async (value) => {
      const identity = record(value, "V2_09_REAL_CHROME_CLICK_IDENTITY_INVALID");
      const keys = [
        "accountId",
        "claimId",
        "clickOrdinal",
        "createRequestSha256",
        "generateClickCount",
        "generationRequestId",
        "idempotencyKey",
        "projectId",
        "projectRevisionId",
        "schemaVersion",
        "source",
        "voiceoverSha256",
        "workspaceId",
      ];
      if (
        projectIdentity === undefined ||
        persistedIdentity !== undefined ||
        Object.keys(identity).sort().join(",") !== keys.sort().join(",") ||
        identity.schemaVersion !== V209_REAL_CHROME_CLICK_IDENTITY_SCHEMA ||
        identity.source !== request.source ||
        identity.accountId !== request.accountId ||
        identity.workspaceId !== request.workspaceId ||
        identity.claimId !== claimId ||
        identity.clickOrdinal !== 1 ||
        identity.generateClickCount !== 1 ||
        identity.idempotencyKey !== projectIdentity.idempotencyKey ||
        identity.createRequestSha256 !== projectIdentity.createRequestSha256 ||
        identity.projectId !== projectIdentity.projectId ||
        identity.projectRevisionId !== projectIdentity.projectRevisionId ||
        !IDENTIFIER.test(String(identity.generationRequestId)) ||
        identity.voiceoverSha256 !== prepared.voiceoverSha256
      )
        fail("V2_09_REAL_CHROME_CLICK_IDENTITY_INVALID");
      const document = Object.freeze({
        schema_version: IDENTITY_FILE_SCHEMA,
        authority_id: input.authorityId,
        request_sha256: requestSha256,
        identity: Object.freeze({ ...identity }),
      });
      writeClickIdentity(clickIdentityPath, document);
      persistedIdentity = document.identity;
    },
  };
  const evidence = await (dependencies.runPlaywright ?? runV209RealChromePlaywright)({
    request: request as never,
    claims,
    productionOrigin: input.productionOrigin,
    authStatePath: input.authStatePath,
    voiceoverPath: input.voiceoverPath,
    verifiedOutputPath: input.verifiedOutputPath,
  });
  if (
    persistedIdentity === undefined ||
    evidence.claimId !== claimId ||
    evidence.generateClickCount !== 1 ||
    evidence.projectId !== persistedIdentity.projectId ||
    evidence.projectRevisionId !== persistedIdentity.projectRevisionId ||
    evidence.generationRequestId !== persistedIdentity.generationRequestId
  )
    fail("V2_09_REAL_CHROME_BRIDGE_EVIDENCE_INVALID");
  return Object.freeze({ schema_version: RESULT_SCHEMA, evidence });
}

async function main(): Promise<void> {
  const output = await runV209RealChromeBridge(JSON.parse(readFileSync(0, "utf8")));
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "V2_09_REAL_CHROME_BRIDGE_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
