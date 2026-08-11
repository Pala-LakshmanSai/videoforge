import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(".github/workflows/ci.yml", "utf8");
const chromeConfig = await readFile("apps/web/playwright.config.ts", "utf8");
const workerdConfig = await readFile("apps/web/playwright.cloudflare.config.ts", "utf8");

test("CI exposes five bounded lanes and one fail-closed aggregate", () => {
  const jobsBlock = workflow.slice(workflow.indexOf("\njobs:\n"));
  const jobs = [...jobsBlock.matchAll(/^\x20{2}([a-z_]+):$/gmu)].map((match) => match[1]);
  assert.deepEqual(jobs, [
    "static_contracts_security",
    "typescript",
    "python",
    "workerd",
    "chrome",
    "required",
  ]);
  assert.match(
    workflow,
    /needs: \[static_contracts_security, typescript, python, workerd, chrome\]/u,
  );
  for (const result of [
    "STATIC_RESULT",
    "TYPESCRIPT_RESULT",
    "PYTHON_RESULT",
    "WORKERD_RESULT",
    "CHROME_RESULT",
  ]) {
    assert.match(workflow, new RegExp(`test "\\$${result}" = success`, "u"));
  }
});

test("CI owns tools and suites only in their responsible lanes", () => {
  assert.equal(workflow.match(/install --with-deps chrome/gu)?.length, 1);
  assert.equal(workflow.match(/install --with-deps chromium/gu)?.length, 1);
  assert.equal(workflow.match(/apt-get install --yes ffmpeg/gu)?.length, 1);
  assert.equal(workflow.includes("pnpm verify\n"), false);
  for (const command of [
    "pnpm ci:static",
    "pnpm ci:typescript",
    "pnpm ci:python",
    "pnpm test:cloudflare-runtime",
    "pnpm test:chrome",
  ]) {
    assert.equal(workflow.split(command).length - 1, 1);
  }
});

test("every execution lane publishes timing and browser evidence", () => {
  for (const lane of ["static", "typescript", "python", "workerd", "chrome"]) {
    assert.match(workflow, new RegExp(`ci-artifacts/${lane}-timing\\.txt`, "u"));
  }
  assert.match(workflow, /apps\/web\/test-results/u);
  assert.match(workflow, /apps\/web\/playwright-workerd-report/u);
  assert.match(workflow, /apps\/web\/playwright-report/u);
  assert.match(chromeConfig, /test-results\/chrome-junit\.xml/u);
  assert.match(workerdConfig, /test-results\/workerd-junit\.xml/u);
});
