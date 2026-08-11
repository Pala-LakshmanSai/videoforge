import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

import { isLanListenerAddress, presentIntegrationSecretNames } from "./dev-policy.mjs";
import { createDoctorReport } from "./doctor-report.mjs";
import {
  integrationEnvironmentMetadata,
  integrationEnvironmentNames,
} from "./environment-metadata.mjs";
import { commandOutput, health, listeningProcess } from "./process.mjs";
import { expectedUvVersion, resolveUv } from "./uv-tool.mjs";

const expected = {
  node: "v22.23.2",
  pnpm: "11.5.2",
};
const checks = [];
const arguments_ = process.argv.slice(2);
const json = arguments_.length === 1 && arguments_[0] === "--json";
if (arguments_.length > (json ? 1 : 0)) {
  console.error("Usage: pnpm doctor [--json]");
  process.exit(1);
}

function record(id, category, name, ok, detail) {
  checks.push({ id, category, name, ok, detail });
}

record(
  "version.node",
  "version",
  "Node",
  process.version === expected.node,
  `${process.version}; expected ${expected.node}`,
);
const pnpmVersion = await commandOutput("pnpm", ["--version"]);
record(
  "version.pnpm",
  "version",
  "pnpm",
  pnpmVersion === expected.pnpm,
  `${pnpmVersion ?? "missing"}; expected ${expected.pnpm}`,
);
const gitVersion = await commandOutput("git", ["--version"]);
record("prerequisite.git", "prerequisite", "Git", Boolean(gitVersion), gitVersion ?? "missing");
const rubyVersion = await commandOutput("ruby", ["--version"]);
record("prerequisite.ruby", "prerequisite", "Ruby", Boolean(rubyVersion), rubyVersion ?? "missing");
const lsofPath = await commandOutput("which", ["lsof"]);
record("prerequisite.lsof", "prerequisite", "lsof", Boolean(lsofPath), lsofPath ?? "missing");

const chromeCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "google-chrome",
  "google-chrome-stable",
];
let chromeExecutable = null;
let chromeVersion = null;
for (const candidate of chromeCandidates) {
  const version = await commandOutput(candidate, ["--version"]);
  if (version?.startsWith("Google Chrome ")) {
    chromeExecutable = candidate;
    chromeVersion = version;
    break;
  }
}
record(
  "prerequisite.chrome",
  "prerequisite",
  "Google Chrome",
  Boolean(chromeExecutable),
  chromeExecutable ? `${chromeVersion}; ${chromeExecutable}` : "missing branded Google Chrome",
);

try {
  const uv = resolveUv();
  const uvVersion = await commandOutput(uv, ["--version"]);
  const normalizedUvVersion = uvVersion?.split(/\s+/u).slice(0, 2).join(" ");
  record(
    "version.uv",
    "version",
    "uv",
    normalizedUvVersion === expectedUvVersion,
    `${uvVersion ?? "missing"}; ${uv}`,
  );
} catch (error) {
  record(
    "version.uv",
    "version",
    "uv",
    false,
    error instanceof Error ? error.message : String(error),
  );
}

const pythonVersion = await commandOutput("python3.12", ["--version"]);
record(
  "version.python",
  "version",
  "Python",
  pythonVersion?.startsWith("Python 3.12.") ?? false,
  `${pythonVersion ?? "missing"}; expected Python 3.12.x`,
);
const ffmpegVersion = await commandOutput("ffmpeg", ["-version"]);
record(
  "version.ffmpeg",
  "version",
  "FFmpeg",
  ffmpegVersion?.startsWith("ffmpeg version 8.1.1") ?? false,
  `${ffmpegVersion?.split("\n")[0] ?? "missing"}; expected 8.1.1`,
);
const ffprobeVersion = await commandOutput("ffprobe", ["-version"]);
record(
  "version.ffprobe",
  "version",
  "FFprobe",
  ffprobeVersion?.startsWith("ffprobe version 8.1.1") ?? false,
  `${ffprobeVersion?.split("\n")[0] ?? "missing"}; expected 8.1.1`,
);

for (const file of [
  "project-context/evidence/create_project_request.schema.json",
  "project-context/evidence/fixtures/create_project_request.valid.json",
  ".env.example",
]) {
  try {
    await access(file, constants.R_OK);
    record(`file.${file}`, "prerequisite", file, true, "present");
  } catch {
    record(`file.${file}`, "prerequisite", file, false, "missing");
  }
}

const envExample = await readFile(".env.example", "utf8");
const credentialNames = presentIntegrationSecretNames(process.env);
record(
  "environment.provider_free",
  "provider_free",
  "Provider-free environment",
  credentialNames.length === 0,
  credentialNames.length === 0
    ? "no credential-bearing integration variables present"
    : `unset before development: ${credentialNames.join(", ")}`,
);
const expectedEnvironmentNames = integrationEnvironmentMetadata
  .filter(({ placeholderRequired }) => placeholderRequired)
  .map(({ name }) => name);
const missingEnvironmentNames = expectedEnvironmentNames.filter(
  (name) => !new RegExp(`^${name}=`, "mu").test(envExample),
);
record(
  "environment.names",
  "environment",
  "Environment names",
  missingEnvironmentNames.length === 0,
  missingEnvironmentNames.length === 0
    ? "all future server-only placeholders present"
    : `missing placeholders: ${missingEnvironmentNames.join(", ")}`,
);

const webOwner = await listeningProcess(4173);
const apiOwner = await listeningProcess(4174);
const webStatus = webOwner ? await health() : null;
const apiStatus = apiOwner ? await health("http://127.0.0.1:4174/api/health") : null;
const validHealth = (status) =>
  status?.app === "videoforge" &&
  status?.status === "ok" &&
  ["fixture", "local"].includes(status?.mode) &&
  status?.synthetic === true &&
  status?.provider_calls_authorized === false &&
  status?.authorized_spend_usd === 0;
const pairedServers =
  Boolean(webOwner && apiOwner) &&
  validHealth(webStatus) &&
  validHealth(apiStatus) &&
  webStatus.mode === apiStatus.mode &&
  webStatus.commit === apiStatus.commit;

if (!webOwner && !apiOwner) {
  record("port.4173", "port", "Port 4173", true, "free");
  record("port.4174", "port", "Port 4174", true, "free");
} else {
  record(
    "port.4173",
    "ownership",
    "Port 4173",
    pairedServers && !(webStatus.mode === "local" && isLanListenerAddress(webOwner.address)),
    webOwner
      ? `PID ${webOwner.pid} (${webOwner.command}); ${webOwner.address ?? "binding unknown"}`
      : "free while an orphaned API listener remains on 4174",
  );
  record(
    "port.4174",
    "ownership",
    "Port 4174",
    pairedServers,
    apiOwner
      ? `PID ${apiOwner.pid} (${apiOwner.command}); ${apiOwner.address ?? "binding unknown"}`
      : "missing while a web listener remains on 4173",
  );
}

const report = createDoctorReport(checks, integrationEnvironmentNames);
if (json) {
  console.log(JSON.stringify(report));
} else {
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }
}

if (!report.ok) process.exit(1);
