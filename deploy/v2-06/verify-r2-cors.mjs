import { readFile } from "node:fs/promises";

const fail = (message) => {
  throw new Error(`V2-06 R2 CORS verification: ${message}`);
};

const originIndex = process.argv.indexOf("--origin");
const expectedOrigin = originIndex >= 0 ? process.argv[originIndex + 1] : undefined;
if (!expectedOrigin) fail("--origin <exact-https-origin> is required");
let parsedOrigin;
try {
  parsedOrigin = new URL(expectedOrigin);
} catch {
  fail("expected origin is not a URL");
}
if (
  parsedOrigin.protocol !== "https:" ||
  parsedOrigin.username ||
  parsedOrigin.password ||
  parsedOrigin.search ||
  parsedOrigin.hash ||
  (parsedOrigin.pathname !== "/" && parsedOrigin.pathname !== "")
)
  fail("expected origin must be a credential-free HTTPS origin without a path");
const origin = parsedOrigin.origin;

const ansi = /\u001b\[[0-?]*[ -/]*[@-~]/gu;
const source = (await readFile("/dev/stdin", "utf8")).replace(ansi, "");
const values = new Map();
for (const line of source.split(/\r?\n/u)) {
  const match =
    /^\s*(allowed_origins|allowed_methods|allowed_headers|exposed_headers|max_age_seconds):\s*(.*?)\s*$/u.exec(
      line,
    );
  if (match) values.set(match[1], match[2]);
}

const required = [
  "allowed_origins",
  "allowed_methods",
  "allowed_headers",
  "exposed_headers",
  "max_age_seconds",
];
for (const key of required) if (!values.has(key)) fail(`Wrangler output is missing ${key}`);
if (values.get("allowed_origins") !== origin) fail("allowed origin is not exact");
if (values.get("allowed_origins")?.includes("*")) fail("wildcard origin is forbidden");

function csv(key) {
  return (values.get(key) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
}
function exactSet(key, expected) {
  if (JSON.stringify(csv(key)) !== JSON.stringify([...expected].sort()))
    fail(`${key} does not match the approved exact set`);
}
exactSet("allowed_methods", ["GET", "HEAD", "PUT"]);
exactSet("allowed_headers", ["Content-Type", "x-amz-checksum-sha256"]);
exactSet("exposed_headers", ["Content-Length", "Content-Type", "ETag", "x-amz-checksum-sha256"]);
if (values.get("max_age_seconds") !== "3600") fail("max_age_seconds must be 3600");

console.log(
  `V2-06 R2 CORS verified for ${origin}: exact origin, methods, headers, exposure, and max age.`,
);
