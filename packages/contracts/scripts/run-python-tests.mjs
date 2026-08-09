import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvPython = path.join(
  packageRoot,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

const candidates = [
  process.env.VIDEOFORGE_CONTRACTS_PYTHON,
  existsSync(venvPython) ? venvPython : undefined,
  "python3.12",
].filter(Boolean);

const python = candidates.find(
  (candidate) =>
    spawnSync(
      candidate,
      [
        "-c",
        "import sys, jsonschema, pydantic, pytest; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)",
      ],
      { stdio: "ignore" },
    ).status === 0,
);

if (!python) {
  console.error(
    "Contracts Python dependencies are missing. Run `pnpm --filter @videoforge/contracts python:install` once.",
  );
  process.exit(1);
}

const result = spawnSync(python, ["-m", "pytest", "-q", "python/tests"], {
  cwd: packageRoot,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
