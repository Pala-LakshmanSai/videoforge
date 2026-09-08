import {
  constants,
  openSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  closeSync,
  fsyncSync,
  existsSync,
  lstatSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
const hash = (x) => "sha256:" + createHash("sha256").update(x).digest("hex");
const canonical = (x) =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x && typeof x === "object"
      ? "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}"
      : JSON.stringify(x);
const fail = (c) => {
  throw Error("V2_09_INTERACTIVE_LOGIN_" + c);
};
function readPrivate(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = fstatSync(fd);
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== process.getuid() ||
      (s.mode & 511) !== 384 ||
      s.size > 8 * 1024 * 1024
    )
      fail("PRIVATE_FILE");
    return readFileSync(fd);
  } catch {
    fail("PRIVATE_FILE");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export async function materializeV209InteractiveLogin(
  { root, authoritySha256, planSha256 },
  dependencies = {},
) {
  if (
    Object.keys(dependencies).some((k) => !["testOnly", "launch", "now", "wait"].includes(k)) ||
    (Object.keys(dependencies).some((k) => k !== "testOnly") && dependencies.testOnly !== true)
  )
    fail("INJECTION_FORBIDDEN");
  if (typeof root !== "string" || resolve(root) !== root) fail("ROOT");
  const ab = readPrivate(resolve(root, "authority.json")),
    pb = readPrivate(resolve(root, "materialization-plan.json"));
  if (hash(ab) !== authoritySha256 || hash(pb) !== planSha256) fail("HASH");
  let a, p;
  try {
    a = JSON.parse(ab);
    p = JSON.parse(pb);
  } catch {
    fail("JSON");
  }
  const c = p.chrome_bootstrap,
    origin = c.productionOrigin,
    clock = dependencies.now ?? Date.now;
  if (
    new URL(origin).origin !== origin ||
    !origin.startsWith("https://") ||
    c.loginTimeoutMs !== 600000 ||
    a.single_use !== true
  )
    fail("CONFIG");
  const target = resolve(root, "chrome-auth-state.json");
  if (c.authStatePath !== target || existsSync(target)) fail("TARGET");
  const binding = {
    mode: "FULL_POST_DEPLOY_BOOTSTRAP",
    origin,
    configuration_sha256: hash(canonical(c)),
    voiceover_sha256: c.voiceoverSha256,
  };
  const stage = target + ".v209-" + hash(canonical(binding)).slice(7, 31) + ".next";
  const claim = {
    schema_version: "videoforge.v2-09-chrome-auth-adoption-claim/v1",
    auth_state_path_sha256: hash(target),
    binding_sha256: hash(canonical(binding)),
    stage_path_sha256: hash(stage),
  };
  if (!readPrivate(target + ".v209-claim.json").equals(Buffer.from(canonical(claim) + "\n")))
    fail("CLAIM");
  const check = () => {
    if (
      hash(readPrivate(resolve(root, "authority.json"))) !== authoritySha256 ||
      hash(readPrivate(resolve(root, "materialization-plan.json"))) !== planSha256 ||
      !readPrivate(target + ".v209-claim.json").equals(Buffer.from(canonical(claim) + "\n"))
    )
      fail("BINDING_DRIFT");
    if (
      typeof c.chromeRequestPath !== "string" ||
      dirname(c.chromeRequestPath) !== root ||
      existsSync(c.chromeRequestPath)
    )
      fail("REQUEST_EXISTS");
    const s = JSON.parse(readPrivate(resolve(root, "combined-outer-state.json")));
    if (
      s.status !== "AWAITING_INTERACTIVE_CHROME_LOGIN" ||
      s.outer_authority_id !== a.authority_id ||
      s.source_commit !== a.source_commit ||
      s.proposal_sha256 !== a.proposal_sha256 ||
      s.operations?.length !== 26 ||
      s.operations.slice(0, 22).some((x) => x.status !== "COMPLETED") ||
      s.operations[22].id !== "materialize-v209-postdeploy-chrome-auth" ||
      s.operations[22].status !== "STARTED" ||
      s.operations.slice(23).some((x) => x.status !== "PENDING") ||
      !(Date.parse(a.expires_at) > clock())
    )
      fail("AUTHORITY");
  };
  check();
  const parent = lstatSync(dirname(stage));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== process.getuid() ||
    (parent.mode & 0o077) !== 0
  )
    fail("PARENT");
  let fd,
    browser,
    context,
    page,
    completed = false;
  try {
    try {
      fd = openSync(
        stage,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        384,
      );
    } catch {
      fail("STAGE_EXISTS");
    }
    const inode = fstatSync(fd);
    const deadline = Math.min(clock() + 600000, Date.parse(a.expires_at));
    const launch =
      dependencies.launch ??
      (async () => {
        const require = createRequire(resolve(root, "source/apps/web/package.json"));
        return require("@playwright/test").chromium.launch({ channel: "chrome", headless: false });
      });
    browser = await launch();
    context = await browser.newContext({
      baseURL: origin,
      acceptDownloads: false,
      serviceWorkers: "block",
    });
    page = await context.newPage();
    await page.goto(origin + "/projects/new", {
      waitUntil: "domcontentloaded",
      timeout: Math.max(1, Math.min(30000, deadline - clock())),
    });
    while (clock() < deadline) {
      check();
      let valid = false;
      if (new URL(page.url()).origin === origin) {
        let result;
        try {
          result = await page.evaluate(
            async (timeoutMs) => {
              const r = await fetch("/api/v2/tenant", {
                headers: { accept: "application/json" },
                signal: AbortSignal.timeout(timeoutMs),
              });
              if (r.status === 401 || r.status === 403) return { pending: true };
              if (r.status !== 200) return { invalid: true };
              const v = await r.json();
              return { schema: v.schema_version, account: v.account_id, workspace: v.workspace_id };
            },
            Math.max(1, Math.min(10000, deadline - clock())),
          );
        } catch (error) {
          if (
            error instanceof Error &&
            /Execution context was destroyed|Cannot find context with specified id|Cannot find context with id/u.test(
              error.message,
            )
          )
            result = { pending: true };
          else throw error;
        }
        if (result.invalid) fail("TENANT");
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        valid =
          result.schema === "videoforge-hosted-tenant/v1" &&
          uuid.test(result.account ?? "") &&
          uuid.test(result.workspace ?? "");
        if (!valid && !result.pending) fail("TENANT");
      }
      if (valid) {
        check();
        const state = await context.storageState();
        if (
          !Array.isArray(state.cookies) ||
          state.cookies.length === 0 ||
          !Array.isArray(state.origins)
        )
          fail("STORAGE");
        check();
        if (clock() >= deadline) fail("LOGIN_DEADLINE");
        const live = lstatSync(stage);
        const held = fstatSync(fd);
        if (
          live.ino !== inode.ino ||
          live.dev !== inode.dev ||
          live.isSymbolicLink() ||
          live.nlink !== 1 ||
          !live.isFile() ||
          live.uid !== process.getuid() ||
          (live.mode & 511) !== 384 ||
          !held.isFile() ||
          held.uid !== process.getuid() ||
          held.nlink !== 1 ||
          (held.mode & 511) !== 384 ||
          held.ino !== inode.ino ||
          held.dev !== inode.dev
        )
          fail("STAGE_DRIFT");
        writeFileSync(fd, JSON.stringify(state));
        fsyncSync(fd);
        completed = true;
        return { status: "CLAIM_BOUND_AUTH_READY", generate_clicks: 0 };
      }
      await (dependencies.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(
        Math.min(1000, Math.max(0, deadline - clock())),
      );
    }
    return { status: "AWAITING_INTERACTIVE_CHROME_LOGIN", generate_clicks: 0 };
  } catch (e) {
    if (e?.message?.startsWith("V2_09_INTERACTIVE_LOGIN_")) throw e;
    fail("BROWSER_OR_READ_FAILED");
  } finally {
    await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
    if (fd !== undefined) {
      const held = fstatSync(fd);
      closeSync(fd);
      if (!completed) {
        try {
          const current = lstatSync(stage);
          if (current.ino === held.ino && current.dev === held.dev && current.size === 0)
            unlinkSync(stage);
        } catch {}
      }
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [root, authoritySha256, planSha256] = process.argv.slice(2);
    console.log(
      JSON.stringify(await materializeV209InteractiveLogin({ root, authoritySha256, planSha256 })),
    );
  } catch (e) {
    console.error(
      e.message.startsWith("V2_09_INTERACTIVE_LOGIN_")
        ? e.message
        : "V2_09_INTERACTIVE_LOGIN_FAILED",
    );
    process.exitCode = 1;
  }
}
