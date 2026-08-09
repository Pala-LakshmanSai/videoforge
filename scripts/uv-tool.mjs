import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const expectedUvVersion = "uv 0.8.13";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const managedRoot = path.join(repoRoot, ".tools", "uv-0.8.13");
const managedPython = path.join(
  managedRoot,
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const managedUv = path.join(
  managedRoot,
  process.platform === "win32" ? "Scripts/uv.exe" : "bin/uv",
);

const hasExactVersion = (command) => {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  const reported = (result.stdout ?? "").trim().split(/\s+/).slice(0, 2).join(" ");
  return result.status === 0 && reported === expectedUvVersion;
};

export const resolveUv = () => {
  for (const candidate of [process.env.VIDEOFORGE_UV, "uv", managedUv].filter(Boolean)) {
    if (hasExactVersion(candidate)) return candidate;
  }
  throw new Error(
    `${expectedUvVersion} is required. Run pnpm python:sync to create the repository-local tool.`,
  );
};

export const ensureUv = () => {
  try {
    return resolveUv();
  } catch {
    const python = process.env.VIDEOFORGE_PYTHON ?? "python3.12";
    const version = spawnSync(python, ["--version"], { encoding: "utf8" });
    if (version.status !== 0 || !version.stdout.startsWith("Python 3.12.")) {
      throw new Error("Python 3.12 is required to bootstrap the repository-local uv tool.");
    }
    const create = spawnSync(python, ["-m", "venv", managedRoot], { stdio: "inherit" });
    if (create.status !== 0)
      throw new Error("Could not create the repository-local uv environment.");
    const install = spawnSync(
      managedPython,
      ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "uv==0.8.13"],
      { stdio: "inherit" },
    );
    if (install.status !== 0 || !hasExactVersion(managedUv)) {
      throw new Error(`Could not install ${expectedUvVersion} in the repository-local tool cache.`);
    }
    return managedUv;
  }
};
