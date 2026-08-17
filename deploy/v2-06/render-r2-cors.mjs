import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(new URL("../..", import.meta.url).pathname);
const templatePath = resolve(root, "deploy/v2-06/r2-cors.template.json");
const fail = (message) => {
  throw new Error(`V2-06 R2 CORS renderer: ${message}`);
};

function parseOrigin(value) {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hostname.includes("*") ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      fail("origin must be a credential-free HTTPS origin without a path");
    return parsed.origin;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2-06")) throw error;
    fail("origin must be an absolute HTTPS URL");
  }
}

const render = async () => {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--"))
      fail("arguments must be --name value pairs");
    args.set(key.slice(2), value);
  }
  for (const key of ["origin", "output"]) if (!args.has(key)) fail(`--${key} is required`);

  const origin = parseOrigin(args.get("origin"));
  const output = resolve(args.get("output"));
  if (output === templatePath || output === root || output.startsWith(`${root}/`))
    fail("rendered CORS config must be written outside the repository");
  let template;
  try {
    template = JSON.parse(await readFile(templatePath, "utf8"));
  } catch {
    fail("tracked CORS template is not readable JSON");
  }
  const rules = template?.rules;
  if (
    !Array.isArray(rules) ||
    rules.length !== 1 ||
    JSON.stringify(rules[0]?.allowed?.methods ?? []) !== JSON.stringify(["GET", "PUT", "HEAD"]) ||
    JSON.stringify(rules[0]?.allowed?.headers ?? []) !==
      JSON.stringify(["Content-Type", "x-amz-checksum-sha256"]) ||
    JSON.stringify(rules[0]?.exposeHeaders ?? []) !==
      JSON.stringify(["Content-Length", "Content-Type", "ETag", "x-amz-checksum-sha256"]) ||
    rules[0]?.maxAgeSeconds !== 3600
  )
    fail("tracked CORS policy drifted from the exact V2-06 policy");
  const rendered = {
    ...template,
    rules: [
      {
        ...rules[0],
        allowed: { ...rules[0].allowed, origins: [origin] },
      },
    ],
  };
  const renderedJson = `${JSON.stringify(rendered, null, 2)}\n`;
  if (renderedJson.includes("__V2_06_")) fail("unresolved CORS placeholder remains");
  try {
    await stat(output);
    fail("refusing to overwrite an existing CORS config");
  } catch (error) {
    if (error instanceof Error && !["ENOENT"].includes(error.code)) throw error;
  }
  await writeFile(output, renderedJson, { encoding: "utf8", mode: 0o600, flag: "wx" });
  const digest = createHash("sha256").update(renderedJson).digest("hex");
  console.log(`Rendered ${output} (sha256:${digest})`);
};

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await render();

export { parseOrigin };
