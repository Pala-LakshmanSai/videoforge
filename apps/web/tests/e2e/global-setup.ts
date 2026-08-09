import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  assertFixtureServerPreflight,
  assertRepositoryOwnedListener,
} from "./fixture-server-preflight";

const healthUrl = "http://localhost:4173/api/health?fixture=happy_generating";
const repositoryRoot = realpathSync(fileURLToPath(new URL("../../../../", import.meta.url)));

function resolveOwnedListener(): { cwd: string; pid: number } {
  let listenerOutput: string;
  try {
    listenerOutput = execFileSync("lsof", ["-nP", "-iTCP:4173", "-sTCP:LISTEN", "-Fpcn"], {
      encoding: "utf8",
    });
  } catch {
    throw new Error("Playwright preflight could not resolve the port 4173 listener owner.");
  }

  const pidText = listenerOutput.match(/^p(\d+)$/mu)?.[1];
  if (!pidText) {
    throw new Error("Playwright preflight found an unowned port 4173 listener.");
  }

  let cwdOutput: string;
  try {
    cwdOutput = execFileSync("lsof", ["-a", "-p", pidText, "-d", "cwd", "-Fn"], {
      encoding: "utf8",
    });
  } catch {
    throw new Error("Playwright preflight could not resolve the port 4173 listener cwd.");
  }
  const cwdValue = cwdOutput.match(/^n(.+)$/mu)?.[1];
  if (!cwdValue) {
    throw new Error("Playwright preflight found a port 4173 listener without a verifiable cwd.");
  }

  let cwd: string;
  try {
    cwd = realpathSync(cwdValue);
  } catch {
    throw new Error("Playwright preflight could not canonicalize the port 4173 listener cwd.");
  }
  assertRepositoryOwnedListener(cwd, repositoryRoot);
  return { cwd, pid: Number(pidText) };
}

export default async function globalSetup(): Promise<void> {
  const expectedCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const listener = resolveOwnedListener();

  let response: Response;
  try {
    response = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error(`Playwright fixture preflight could not reach ${healthUrl}.`);
  }
  if (!response.ok) {
    throw new Error(
      `Playwright fixture preflight health request failed with HTTP ${response.status}.`,
    );
  }

  let health: unknown;
  try {
    health = await response.json();
  } catch {
    throw new Error("Playwright fixture preflight received a non-JSON health response.");
  }

  assertFixtureServerPreflight(health, expectedCommit);
  console.log(
    `Playwright fixture preflight passed for VideoForge ${expectedCommit} at $0 (owned PID ${listener.pid}).`,
  );
}
