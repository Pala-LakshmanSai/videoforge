import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const fail = () => { throw new Error("CLOUD_MEDIA_RELEASE_INPUT_INVALID"); };
// This retained historical migration was never applied on the verified production ledger.
// Preserve its absence; no other missing retained migration is allowed.
const OMITTED_PRODUCTION_MIGRATION = Object.freeze({
  version: 148, name: "hosted_lane_batch_budget_ceiling_bound",
  filename: "0148_hosted_lane_batch_budget_ceiling_bound.sql",
  sha256: "sha256:4f1f631326456483b479137affb5991281697e20a6cd35718156022acfa28a38",
});
export const CLOUD_VARIABLES = Object.freeze([
  "VIDEOFORGE_CLOUD_MEDIA_ENABLED", "VIDEOFORGE_CLOUD_MEDIA_IMAGE",
  "VIDEOFORGE_CLOUD_MEDIA_REGISTRY_ID", "VIDEOFORGE_CLOUD_MEDIA_SOURCE_SHA256",
  "VIDEOFORGE_CLOUD_MEDIA_RUNTIME_MANIFEST_JSON", "VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID",
  "VIDEOFORGE_CLOUD_MEDIA_MAX_HOURLY_USD", "VIDEOFORGE_CLOUD_MEDIA_BUDGET_USD",
  "VIDEOFORGE_CLOUD_MEDIA_MAX_RENTAL_SECONDS",
]);

export function validateCloudVariables(vars) {
  const present = CLOUD_VARIABLES.filter((key) => Object.hasOwn(vars, key));
  if (!present.length) return;
  if (present.length === 1 && vars.VIDEOFORGE_CLOUD_MEDIA_ENABLED === "false") return;
  if (!["true", "false"].includes(vars.VIDEOFORGE_CLOUD_MEDIA_ENABLED) ||
    CLOUD_VARIABLES.filter((key) => key !== "VIDEOFORGE_CLOUD_MEDIA_REGISTRY_ID").some((key) => !Object.hasOwn(vars, key))) fail();
  let release, desktop;
  try {
    release = JSON.parse(vars.VIDEOFORGE_CLOUD_MEDIA_RUNTIME_MANIFEST_JSON);
    desktop = JSON.parse(vars.MEDIA_WORKER_RELEASE_MANIFEST_JSON);
  } catch { fail(); }
  const sha = /^sha256:[0-9a-f]{64}$/u;
  const tooling = release.tooling;
  const seconds = Number(vars.VIDEOFORGE_CLOUD_MEDIA_MAX_RENTAL_SECONDS);
  if (!/^[a-z0-9./:_-]+@sha256:[0-9a-f]{64}$/u.test(vars.VIDEOFORGE_CLOUD_MEDIA_IMAGE) ||
    !sha.test(vars.VIDEOFORGE_CLOUD_MEDIA_SOURCE_SHA256) ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(vars.VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID) ||
    (vars.VIDEOFORGE_CLOUD_MEDIA_REGISTRY_ID !== undefined && !/^[A-Za-z0-9_-]{1,80}$/u.test(vars.VIDEOFORGE_CLOUD_MEDIA_REGISTRY_ID)) ||
    release.schema_version !== "videoforge-runpod-media-release/v1" || release.qualified !== true ||
    release.platform !== "linux/amd64" || release.source_sha256 !== vars.VIDEOFORGE_CLOUD_MEDIA_SOURCE_SHA256 ||
    !sha.test(release.runtime_sha256) || !tooling ||
    !["ffmpeg_sha256", "ffprobe_sha256", "whisper_sha256", "whisper_model_sha256"].every((key) => sha.test(tooling[key])) ||
    tooling.whisper_model_sha256 !== desktop.whisper_model_sha256 ||
    tooling.ffmpeg_version !== "8.1.2" || tooling.ffprobe_version !== "8.1.2" || tooling.whisper_version !== "1.8.4" ||
    ![vars.VIDEOFORGE_CLOUD_MEDIA_MAX_HOURLY_USD, vars.VIDEOFORGE_CLOUD_MEDIA_BUDGET_USD].every((value) => Number.isFinite(Number(value)) && Number(value) > 0) ||
    !Number.isSafeInteger(seconds) || seconds < 60 || seconds > 14_400) fail();
}

/** Local preparation only. Preserve every baseline binding and secret declaration. */
export function prepareCloudConfig(baseline, commit, cloudVariables = { VIDEOFORGE_CLOUD_MEDIA_ENABLED: "false" }) {
  if (!/^[0-9a-f]{40}$/u.test(commit) || !baseline?.vars ||
    Object.keys(cloudVariables).some((key) => !CLOUD_VARIABLES.includes(key))) fail();
  const output = structuredClone(baseline);
  for (const key of CLOUD_VARIABLES) delete output.vars[key];
  Object.assign(output.vars, cloudVariables, { VIDEOFORGE_CLOUD_MEDIA_ENABLED: "false", VIDEOFORGE_COMMIT: commit });
  validateCloudVariables(output.vars);
  return output;
}

/** Guard the complete observed ledger, including archived entries; apply only214. */
export function prepareMigrationSql(observed, manifest, sql) {
  const expected = manifest.migrations.find((entry) => entry.version === 214);
  if (!expected || expected.filename !== "0214_optional_runpod_media.sql" || hash(sql) !== expected.sha256 || !Array.isArray(observed)) fail();
  const ledger = observed.map(({ version, name, filename, sha256 }) => ({ version: Number(version), name, filename, sha256 })).sort((a, b) => a.version - b.version);
  if (!ledger.length || ledger.at(-1).version !== 213 || new Set(ledger.map((entry) => entry.version)).size !== ledger.length ||
    ledger.some((entry) => !Number.isSafeInteger(entry.version) || entry.version < 1 || entry.version > 213 ||
      !/^[a-z0-9_]+$/u.test(entry.name) || entry.filename !== `${String(entry.version).padStart(4, "0")}_${entry.name}.sql` ||
      !/^sha256:[0-9a-f]{64}$/u.test(entry.sha256))) fail();
  for (const entry of manifest.migrations.filter((item) => item.version < 214)) {
    const observedEntry = ledger.find((item) => item.version === entry.version);
    if (!observedEntry && JSON.stringify(entry) === JSON.stringify(OMITTED_PRODUCTION_MIGRATION)) continue;
    if (JSON.stringify(observedEntry) !== JSON.stringify(entry)) fail();
  }
  // Archived source is intentionally absent. Preserve its observed ledger identity in the guard;
  // do not invent its checksum, restore its source, or replay it.
  const guard = JSON.stringify(ledger);
  return `BEGIN;\nSELECT pg_advisory_xact_lock(1448494662,1);\nDO $cloud_guard$ BEGIN\nIF (SELECT COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'filename',filename,'sha256',sha256) ORDER BY version),'[]'::jsonb) FROM public.videoforge_schema_migrations) IS DISTINCT FROM ${literal(guard)}::jsonb THEN RAISE EXCEPTION 'Cloud media migration ledger drift'; END IF;\nEND $cloud_guard$;\n${sql}\nINSERT INTO public.videoforge_schema_migrations(version,name,filename,sha256) VALUES(214,${literal(expected.name)},${literal(expected.filename)},${literal(expected.sha256)});\nCOMMIT;\n`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 8 || args[0] !== "--ledger" || args[2] !== "--baseline-config" || args[4] !== "--output-prefix" || args[6] !== "--commit") fail();
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const [ledger, baseline, manifest, sql] = await Promise.all([
    readFile(resolve(args[1]), "utf8"), readFile(resolve(args[3]), "utf8"),
    readFile(resolve(root, "packages/control-plane/migrations/manifest.json"), "utf8"),
    readFile(resolve(root, "packages/control-plane/migrations/0214_optional_runpod_media.sql"), "utf8"),
  ]);
  const config = JSON.parse(baseline);
  const prepared = prepareCloudConfig(config, args[7]);
  const migration = prepareMigrationSql(JSON.parse(ledger), JSON.parse(manifest), sql);
  await writeFile(`${resolve(args[5])}.sql`, migration, { flag: "wx", mode: 0o600 });
  await writeFile(`${resolve(args[5])}.json`, `${JSON.stringify(prepared, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ allocation_enabled: false, executed: false, network_calls: 0, migration_sha256: hash(sql) })}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
