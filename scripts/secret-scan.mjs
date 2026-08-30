import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const forbiddenTrackedNames = [/(?:^|\/)\.env(?:\..+)?$/u, /(?:^|\/)[^/]+\.(?:key|p12|pfx)$/iu];
const allowedTrackedNames = new Set([".env.example"]);
const patterns = [
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/gu],
  ["GitHub personal token", /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,})\b/gu],
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/gu],
  ["private key block", /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/gu],
  [
    "provider key assignment",
    /\b(?:BETTER_AUTH_SECRET|CLOUDFLARE_API_TOKEN|DATABASE_URL|GOOGLE_CLIENT_SECRET|NEON_DATABASE_URL|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|RUNPOD_API_KEY|RUNWARE_API_KEY)[ \t]*=[ \t]*["']?[A-Za-z0-9_:/+.-]{16,}/gu,
  ],
];

const findings = [];
for (const file of tracked) {
  if (
    !allowedTrackedNames.has(file) &&
    forbiddenTrackedNames.some((pattern) => pattern.test(file))
  ) {
    findings.push(`${file}: tracked secret-bearing filename`);
  }

  const metadata = await stat(file).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (metadata === null) continue;
  if (!metadata.isFile() || metadata.size > 2_000_000) continue;
  const bytes = await readFile(file);
  if (bytes.includes(0)) continue;
  const contents = bytes.toString("utf8");
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of contents.matchAll(pattern)) {
      const line = contents.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line}: ${label}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Tracked-file secret scan failed (values intentionally suppressed):");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Tracked-file secret scan passed (${tracked.length} files).`);
