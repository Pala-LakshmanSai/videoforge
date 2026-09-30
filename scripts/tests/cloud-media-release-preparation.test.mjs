import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { prepareCloudConfig, prepareMigrationSql, validateCloudVariables } from "../../deploy/cloud-media/prepare-release.mjs";

test("release preparation preserves bindings and defaults Cloud off even when supplied enabled", () => {
  const baseline = { vars: { VIDEOFORGE_COMMIT: "a".repeat(40), VIDEOFORGE_GENERATION_PROVIDER: "KIE_FAL_API", VIDEOFORGE_CLOUD_MEDIA_ENABLED: "true" }, workflows: [{ binding: "VIDEO_WORKFLOW" }], secrets: ["EXISTING_SECRET_NAME"] };
  const prepared = prepareCloudConfig(baseline, "b".repeat(40));
  assert.deepEqual(prepared.workflows, baseline.workflows);
  assert.deepEqual(prepared.secrets, baseline.secrets);
  assert.equal(prepared.vars.VIDEOFORGE_GENERATION_PROVIDER, "KIE_FAL_API");
  assert.equal(prepared.vars.VIDEOFORGE_CLOUD_MEDIA_ENABLED, "false");
  assert.equal(baseline.vars.VIDEOFORGE_CLOUD_MEDIA_ENABLED, "true");
  assert.throws(() => validateCloudVariables({ VIDEOFORGE_CLOUD_MEDIA_ENABLED: "true" }));
  assert.throws(() => prepareCloudConfig(baseline, "b".repeat(40), { RUNPOD_API_KEY: "never-written" }));
});

test("only214 is emitted with complete observed ledger guard, archived identities retained", () => {
  const sql = "SELECT 214;";
  const record = (version) => ({ version, name: `migration_${version}`, filename: `${String(version).padStart(4, "0")}_migration_${version}.sql`, sha256: `sha256:${"a".repeat(64)}` });
  const prior = [record(1), record(213)];
  const current = { version: 214, name: "optional_runpod_media", filename: "0214_optional_runpod_media.sql", sha256: `sha256:${createHash("sha256").update(sql).digest("hex")}` };
  const manifest = { migrations: [...prior, current] };
  const ledger = [prior[0], record(21), record(148), prior[1]];
  const prepared = prepareMigrationSql(ledger, manifest, sql);
  assert.match(prepared, /pg_advisory_xact_lock\(1448494662,1\)/u);
  assert.match(prepared, /IS DISTINCT FROM/u);
  assert.ok(prepared.includes(JSON.stringify(ledger)));
  assert.equal((prepared.match(/INSERT INTO public.videoforge_schema_migrations/gu) ?? []).length, 1);
  assert.match(prepared, /VALUES\(214,/u);
  assert.throws(() => prepareMigrationSql(ledger.slice(0, -1), manifest, sql));
  assert.throws(() => prepareMigrationSql([...ledger, current], manifest, sql));
  assert.ok(prepareMigrationSql([...ledger, record(212)], manifest, sql).includes("0212_migration_212.sql"));
  assert.throws(() => prepareMigrationSql([...ledger, record(213)], manifest, sql));
  assert.throws(() => prepareMigrationSql(ledger, manifest, `${sql}SELECT 1;`));
  assert.throws(() => prepareMigrationSql(ledger.map((entry) => entry.version === 213 ? { ...entry, sha256: `sha256:${"b".repeat(64)}` } : entry), manifest, sql));
});

test("verified omitted148 stays absent; other omissions and checksum drift fail closed", () => {
  const sql = "SELECT 214;";
  const record = (version) => ({ version, name: `migration_${version}`, filename: `${String(version).padStart(4, "0")}_migration_${version}.sql`, sha256: `sha256:${"a".repeat(64)}` });
  const omitted = { version: 148, name: "hosted_lane_batch_budget_ceiling_bound", filename: "0148_hosted_lane_batch_budget_ceiling_bound.sql", sha256: "sha256:4f1f631326456483b479137affb5991281697e20a6cd35718156022acfa28a38" };
  const current = { version: 214, name: "optional_runpod_media", filename: "0214_optional_runpod_media.sql", sha256: `sha256:${createHash("sha256").update(sql).digest("hex")}` };
  const ledger = [record(1), record(213)];
  const manifest = { migrations: [ledger[0], omitted, ledger[1], current] };
  const prepared = prepareMigrationSql(ledger, manifest, sql);
  assert.ok(prepared.includes(JSON.stringify(ledger)));
  assert.equal(prepared.includes(omitted.filename), false);
  assert.throws(() => prepareMigrationSql(ledger, { migrations: [...manifest.migrations, record(147)] }, sql));
  assert.throws(() => prepareMigrationSql(ledger, { migrations: manifest.migrations.map((entry) => entry.version === 148 ? { ...entry, sha256: `sha256:${"b".repeat(64)}` } : entry) }, sql));
  assert.throws(() => prepareMigrationSql([...ledger, { ...omitted, sha256: `sha256:${"b".repeat(64)}` }], manifest, sql));
});


test("new additive recovery and telemetry migrations guard exact214 before215 and exact215 before216", () => {
  const entry = (version, name, sql) => ({ version, name, filename: `${String(version).padStart(4,"0")}_${name}.sql`, sha256: `sha256:${createHash("sha256").update(sql).digest("hex")}` });
  const original = entry(214,"optional_runpod_media","SELECT 214;");
  const recovery = entry(215,"hosted_cloud_asr_recovery","SELECT 215;");
  const disk = entry(216,"cloud_media_disk_measurements","SELECT 216;");
  const span = entry(217,"hosted_span_audio_current_asr_receipt","SELECT 217;");
  const preprovider = entry(218,"hosted_cloud_preprovider_media","SELECT 218;");
  const manifest = { migrations: [original,recovery,disk,span,preprovider] };
  const first = prepareMigrationSql([original],manifest,"SELECT 215;",215);
  assert.match(first,/VALUES\(215,/u);
  assert.ok(first.includes(JSON.stringify([original])));
  assert.equal(first.includes("SELECT 214;"),false);
  const second = prepareMigrationSql([original,recovery],manifest,"SELECT 216;",216);
  assert.match(second,/VALUES\(216,/u);
  assert.ok(second.includes(JSON.stringify([original,recovery])));
  assert.throws(()=>prepareMigrationSql([original],manifest,"SELECT 216;",216));
  assert.throws(()=>prepareMigrationSql([original,recovery,disk],manifest,"SELECT 216;",216));
  assert.throws(()=>prepareMigrationSql([original],manifest,"SELECT 216;",215));
  assert.throws(()=>prepareMigrationSql([original],manifest,"SELECT 217;",217));
  const third = prepareMigrationSql([original,recovery,disk],manifest,"SELECT 217;",217);
  assert.match(third,/VALUES\(217,/u);
  assert.ok(third.includes(JSON.stringify([original,recovery,disk])));
  assert.equal(third.includes("SELECT 216;"),false);
  assert.throws(()=>prepareMigrationSql([original,recovery,disk,span],manifest,"SELECT 217;",217));
  assert.throws(()=>prepareMigrationSql([original,recovery,disk],manifest,"SELECT 217;SELECT 1;",217));
  const fourth = prepareMigrationSql([original,recovery,disk,span],manifest,"SELECT 218;",218);
  assert.match(fourth,/VALUES\(218,/u);
  assert.ok(fourth.includes(JSON.stringify([original,recovery,disk,span])));
  assert.equal(fourth.includes("SELECT 217;"),false);
  assert.throws(()=>prepareMigrationSql([original,recovery,disk],manifest,"SELECT 218;",218));
  assert.throws(()=>prepareMigrationSql([original,recovery,disk,span,preprovider],manifest,"SELECT 218;",218));
  assert.throws(()=>prepareMigrationSql([original,recovery,disk,span],manifest,"SELECT 218;SELECT 1;",218));
});

test("230 emits only the stream upgrade after a checksum-exact229 ledger",()=>{
 const entry=(version,name,sql)=>({version,name,filename:`${String(version).padStart(4,"0")}_${name}.sql`,sha256:`sha256:${createHash("sha256").update(sql).digest("hex")}`});
 const prior=entry(229,"prior","SELECT 229;"),stream=entry(230,"hosted_cloud_span_stream","SELECT 230;");
 const manifest={migrations:[prior,stream]};
 const prepared=prepareMigrationSql([prior],manifest,"SELECT 230;",230);
 assert.match(prepared,/VALUES\(230,/u);assert.equal(prepared.includes("SELECT 229;"),false);
 assert.throws(()=>prepareMigrationSql([prior,stream],manifest,"SELECT 230;",230));
 assert.throws(()=>prepareMigrationSql([prior],manifest,"SELECT 230;SELECT 1;",230));
});
