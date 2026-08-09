import { spawnSync } from "node:child_process";

const workers = ["image-media", "avatar-primary", "avatar-repair", "avatar-quality"];

for (const worker of workers) {
  const result = spawnSync(
    "python3.12",
    ["-m", "unittest", "discover", "-s", `workers/${worker}/tests`, "-p", "test_*.py"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Worker health tests passed (${workers.length} isolated Python 3.12 lanes).`);
