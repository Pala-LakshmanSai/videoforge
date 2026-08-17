import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(new URL("../..", import.meta.url).pathname);
const templatePath = resolve(root, "apps/web/wrangler.staging.jsonc");
const stagingBuildRoot = resolve(root, "apps/web/dist-staging");
const workerBundlePath = resolve(stagingBuildRoot, "videoforge_v2_06_staging/index.js");
const assetsDirectory = resolve(stagingBuildRoot, "client");
const fail = (message) => {
  throw new Error(`V2-06 staging config renderer: ${message}`);
};
const git = (args) => {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) fail(`Git command failed: ${result.error.message}`);
  return result;
};
const requireCleanHeadCommit = (commit) => {
  if (!/^[0-9a-f]{40}$/iu.test(commit)) fail("commit must be the full 40-hex Git commit SHA");

  const object = git(["cat-file", "-e", `${commit}^{commit}`]);
  if (object.status !== 0) fail("commit does not name an existing Git commit");

  const headResult = git(["rev-parse", "HEAD"]);
  if (headResult.status !== 0) fail("unable to resolve current HEAD");
  const head = headResult.stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(head) || head !== commit)
    fail("commit must exactly equal the current HEAD");

  const unstaged = git(["diff", "--quiet"]);
  if (unstaged.status !== 0) fail("working tree has unstaged changes");

  const staged = git(["diff", "--cached", "--quiet"]);
  if (staged.status !== 0) fail("index has staged changes");
};
const requireNonEmptyClientAsset = async (directory) => {
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && entry.name !== ".assetsignore") {
        const entryMetadata = await stat(entryPath);
        if (entryMetadata.size > 0) return;
      }
    }
  }
  fail(
    "staging assets directory has no non-empty regular client asset; run pnpm --filter @videoforge/web build:staging again",
  );
};
const render = async () => {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--"))
      fail("arguments must be --name value pairs");
    args.set(key.slice(2), value);
  }
  for (const key of ["account-id", "origin", "commit", "release-manifest-file", "output"])
    if (!args.has(key)) fail(`--${key} is required`);

  const accountId = args.get("account-id");
  if (!/^[0-9a-f]{32}$/iu.test(accountId))
    fail("Cloudflare account ID must be 32 hexadecimal characters");
  const commit = args.get("commit");
  requireCleanHeadCommit(commit);
  const suppliedOrigin = args.get("origin");
  let origin;
  try {
    const parsed = new URL(suppliedOrigin);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      fail("origin must be a credential-free HTTPS origin without a path");
    origin = parsed.origin;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2-06")) throw error;
    fail("origin must be an absolute HTTPS URL");
  }

  let release;
  try {
    release = JSON.parse(await readFile(resolve(args.get("release-manifest-file")), "utf8"));
  } catch {
    fail("release manifest file is not readable JSON");
  }
  const expectedReleaseKeys = [
    "execution_bundle_sha256",
    "macos",
    "minimum_protocol_version",
    "schema_version",
    "version",
    "whisper_model_sha256",
    "windows",
  ];
  if (
    !release ||
    typeof release !== "object" ||
    Array.isArray(release) ||
    JSON.stringify(Object.keys(release).sort()) !== JSON.stringify(expectedReleaseKeys) ||
    release.schema_version !== "videoforge-media-worker-release/v1" ||
    typeof release.version !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/u.test(release.version) ||
    !Number.isSafeInteger(release.minimum_protocol_version) ||
    release.minimum_protocol_version < 1 ||
    !/^sha256:[0-9a-f]{64}$/u.test(release.execution_bundle_sha256) ||
    !/^sha256:[0-9a-f]{64}$/u.test(release.whisper_model_sha256)
  )
    fail("release manifest identity is malformed");
  for (const platform of ["windows", "macos"]) {
    const file = release[platform];
    const trust =
      platform === "windows"
        ? ["UNSIGNED_BETA", "AUTHENTICODE_SIGNED"]
        : ["AD_HOC_BETA", "DEVELOPER_ID_NOTARIZED"];
    if (
      !file ||
      typeof file !== "object" ||
      JSON.stringify(Object.keys(file).sort()) !==
        JSON.stringify(["sha256", "size_bytes", "trust", "url"]) ||
      !/^https:\/\//u.test(file.url) ||
      !/^sha256:[0-9a-f]{64}$/u.test(file.sha256) ||
      !Number.isSafeInteger(file.size_bytes) ||
      file.size_bytes < 1 ||
      !trust.includes(file.trust)
    )
      fail(`${platform} release identity is malformed`);
    try {
      const parsed = new URL(file.url);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      )
        fail(`${platform} release URL must be credential-free HTTPS without query or fragment`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("V2-06")) throw error;
      fail(`${platform} release URL is not an absolute HTTPS URL`);
    }
  }
  const releaseJson = JSON.stringify(release);

  const requireBuildArtifact = async (path, kind) => {
    let metadata;
    try {
      metadata = await stat(path);
    } catch {
      fail(`${kind} is missing; run pnpm --filter @videoforge/web build:staging first`);
    }
    if (
      (kind === "Worker bundle" && !metadata.isFile()) ||
      (kind === "staging assets directory" && !metadata.isDirectory())
    )
      fail(`${kind} has the wrong type; run pnpm --filter @videoforge/web build:staging again`);
    if (metadata.size === 0 && kind === "Worker bundle")
      fail("Worker bundle is empty; run `pnpm --filter @videoforge/web build:staging` again");
    if (kind === "staging assets directory") await requireNonEmptyClientAsset(path);
  };
  await requireBuildArtifact(workerBundlePath, "Worker bundle");
  await requireBuildArtifact(assetsDirectory, "staging assets directory");

  const parseJsonc = (source) => JSON.parse(source.replace(/,\s*([}\]])/gu, "$1"));
  const template = parseJsonc(await readFile(templatePath, "utf8"));
  const replacements = new Map([
    ["__V2_06_CLOUDFLARE_ACCOUNT_ID__", accountId],
    ["__V2_06_STAGING_HTTPS_ORIGIN__", origin],
    ["__V2_06_DEPLOYED_COMMIT__", commit],
    ["__V2_06_PERSONAL_WORKER_RELEASE_MANIFEST_JSON__", releaseJson],
  ]);
  function replace(value) {
    if (typeof value === "string") return replacements.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value;
  }
  const rendered = replace(template);
  // The rendered file lives outside the repository. Relative main/assets paths
  // would resolve against /tmp and deploy the wrong tree (or fail after a
  // partial provider action), so point Wrangler at the Vite output explicitly.
  // Keep bundling enabled: the Vite entry is a small module that imports
  // generated chunks beside it, and no_bundle would upload only that stub.
  rendered.main = workerBundlePath;
  rendered.no_bundle = false;
  rendered.assets = { ...rendered.assets, directory: assetsDirectory };
  const renderedJson = `${JSON.stringify(rendered, null, 2)}\n`;
  if (/__V2_06_[A-Z0-9_]+__/u.test(renderedJson)) fail("unresolved deployment placeholder remains");
  const output = resolve(args.get("output"));
  if (output === templatePath) fail("refusing to overwrite the tracked template");
  if (output === root || output.startsWith(`${root}/`))
    fail("rendered config must be written outside the repository");
  await writeFile(output, renderedJson, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const sha256 = createHash("sha256").update(renderedJson).digest("hex");
  console.log(`Rendered ${output} (sha256:${sha256})`);
};

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await render();

export { requireCleanHeadCommit, requireNonEmptyClientAsset };
