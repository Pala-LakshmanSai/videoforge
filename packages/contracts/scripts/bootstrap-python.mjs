import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvRoot = path.join(packageRoot, ".venv");
const venvPython = path.join(
  venvRoot,
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

function isPython312(command) {
  return (
    spawnSync(
      command,
      ["-c", "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)"],
      { stdio: "ignore" },
    ).status === 0
  );
}

const requestedPython = process.env.VIDEOFORGE_CONTRACTS_PYTHON;
const candidates = [requestedPython, "python3.12"].filter(Boolean);
const basePython = candidates.find((candidate) => isPython312(candidate));

if (!basePython) {
  console.error("Python 3.12 is required to bootstrap the contracts environment.");
  process.exit(1);
}

if (existsSync(venvPython) && !isPython312(venvPython)) {
  console.error("The existing contracts .venv is not Python 3.12; recreate it before continuing.");
  process.exit(1);
}

if (!existsSync(venvPython)) {
  const create = spawnSync(basePython, ["-m", "venv", venvRoot], {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (create.status !== 0) process.exit(create.status ?? 1);
}

const install = spawnSync(
  venvPython,
  ["-m", "pip", "install", "--disable-pip-version-check", "-e", ".[test]"],
  { cwd: packageRoot, stdio: "inherit" },
);
process.exit(install.status ?? 1);
