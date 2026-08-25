import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  parseProductionConfig,
  TEMPLATE_PATH,
  validateProductionConfig,
} from "./validate-production-config.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const RENDERER = resolve(ROOT, "deploy/v2-13/render-production-config.mjs");
const CONFIRMATION = "DEPLOY_EXACT_RENDERED_V2_13_PRODUCTION_CONFIG";
const PROVIDER_FREE_ENV = Object.freeze({
  ...process.env,
  CI: "1",
  WRANGLER_SEND_METRICS: "false",
});
const fail = (message) => {
  throw new Error(`V2-13 production deployment wrapper: ${message}`);
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    ...options,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(result.stderr || result.stdout || `${command} failed`);
  return result;
}

async function main() {
  const tokens = process.argv.slice(2);
  if (tokens.length === 0) {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "videoforge-v2-13-production-deployment-dry-run/v1",
        state: "DISABLED_UNQUALIFIED",
        config_rendered: false,
        config_validated: false,
        wrangler_invoked: false,
        deployment_attempted: false,
        provider_calls: 0,
        credential_reads: 0,
        external_spend_usd: 0,
      })}\n`,
    );
    return;
  }
  const executeIndex = tokens.indexOf("--execute");
  const verifyIndex = tokens.indexOf("--verify-only");
  if (executeIndex < 0 === verifyIndex < 0)
    fail("non-default use requires exactly one of --verify-only or --execute");
  const execute = executeIndex >= 0;
  tokens.splice(execute ? executeIndex : verifyIndex, 1);
  const args = new Map();
  for (let index = 0; index < tokens.length; index += 2) {
    if (
      !tokens[index]?.startsWith("--") ||
      tokens[index + 1] === undefined ||
      tokens[index + 1].startsWith("--")
    )
      fail("arguments must be --name value pairs");
    args.set(tokens[index].slice(2), tokens[index + 1]);
  }
  for (const key of ["activation-record", "release-manifest-file"]) {
    if (!args.has(key)) fail(`--${key} is required`);
  }
  if (
    [...args.keys()].some(
      (key) => !["activation-record", "release-manifest-file", "confirm"].includes(key),
    )
  )
    fail("unknown deployment argument");
  if (execute && args.get("confirm") !== CONFIRMATION) fail(`--confirm must equal ${CONFIRMATION}`);
  if (!execute && args.has("confirm"))
    fail("--verify-only does not accept deployment confirmation");

  // Build and scan the exact production Worker/client before composing any deployable config.
  run("pnpm", ["--filter", "@videoforge/web", "build:cloudflare"], {
    env: PROVIDER_FREE_ENV,
  });

  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "videoforge-v2-13-production-"));
  const renderedPath = resolve(temporaryDirectory, "wrangler.production.activated.json");
  try {
    if (renderedPath === TEMPLATE_PATH || renderedPath.startsWith(`${ROOT}/`))
      fail("activated config must be an isolated temporary file outside the repository");
    run(process.execPath, [
      RENDERER,
      "--activate",
      "--activation-record",
      resolve(args.get("activation-record")),
      "--release-manifest-file",
      resolve(args.get("release-manifest-file")),
      "--output",
      renderedPath,
    ]);
    const renderedSource = await readFile(renderedPath, "utf8");
    if (/__V2_13_|unresolved|00000000000000000000000000000000/u.test(renderedSource))
      fail("temporary activated config retains a template placeholder");
    validateProductionConfig(parseProductionConfig(renderedSource), { mode: "activated" });

    const dryRunOutput = resolve(temporaryDirectory, "wrangler-dry-run");
    run(
      "pnpm",
      [
        "--filter",
        "@videoforge/web",
        "exec",
        "wrangler",
        "deploy",
        "--dry-run",
        "--outdir",
        dryRunOutput,
        "--config",
        renderedPath,
      ],
      { env: PROVIDER_FREE_ENV },
    );
    if (!execute) {
      process.stdout.write(
        `${JSON.stringify({
          schema_version: "videoforge-v2-13-production-deployment-verification/v1",
          state: "DISABLED_UNQUALIFIED",
          production_build_verified: true,
          activated_config_validated: true,
          wrangler_dry_run_succeeded: true,
          deployment_attempted: false,
          provider_calls: 0,
          credential_reads: 0,
          external_spend_usd: 0,
        })}\n`,
      );
      return;
    }

    run(
      "pnpm",
      ["--filter", "@videoforge/web", "exec", "wrangler", "deploy", "--config", renderedPath],
      { stdio: "inherit", encoding: undefined },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();
