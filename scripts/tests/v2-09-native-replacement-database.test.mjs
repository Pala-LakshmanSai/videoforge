import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  databaseBytesHash,
  renderNativeMigration87Sql,
  renderNativeMigration88Sql,
  renderNativeMigration89Sql,
  renderNativeMigration90Sql,
  renderNativeMigration91Sql,
  renderNativeMigration92Sql,
  renderNativeMigration93Sql,
  renderNativeMigration94Sql,
  renderNativeMigration95Sql,
  renderNativeMigration96Sql,
  renderNativeMigration97Sql,
  renderNativeMigration98Sql,
  renderNativeMigration99Sql,
  executeNativeDatabaseOnce,
} from "../../deploy/v2-09/native-replacement-database.mjs";

function fixture(t, target) {
  const sourceRoot = resolve("packages/control-plane/migrations");
  const manifest = JSON.parse(readFileSync(resolve(sourceRoot, "manifest.json")));
  const migrationRoot = mkdtempSync(resolve(tmpdir(), "v209-migration-render-"));
  t.after(() => rmSync(migrationRoot, { recursive: true, force: true }));
  manifest.migrations = manifest.migrations.slice(0, target);
  for (const e of manifest.migrations)
    copyFileSync(resolve(sourceRoot, e.filename), resolve(migrationRoot, e.filename));
  const bytes = Buffer.from(JSON.stringify(manifest));
  writeFileSync(resolve(migrationRoot, "manifest.json"), bytes);
  return {
    migrationRoot,
    manifestSha256: databaseBytesHash(bytes),
    migrationSha256: manifest.migrations[target - 1].sha256,
  };
}
test("replacement applies only87 behind exact86 ledger and transaction lock", (t) => {
  const input = fixture(t, 87);
  const sql = renderNativeMigration87Sql(input);
  assert.match(sql, /BEGIN;\nSELECT pg_advisory_xact_lock\(1448494662,9\);/);
  assert.equal((sql.match(/INSERT INTO public.videoforge_schema_migrations/g) || []).length, 1);
  assert.match(sql, /VALUES\(87,/);
  assert.equal(
    (sql.match(/RAISE EXCEPTION 'V209 native migration ledger drift'/g) || []).length,
    2,
  );
  assert.match(sql, /COMMIT;\nSELECT jsonb_build_object/);
});
test("manifest or migration hash changes prevent SQL generation", (t) => {
  const input = fixture(t, 87);
  assert.throws(
    () => renderNativeMigration87Sql({ ...input, manifestSha256: "sha256:" + "0".repeat(64) }),
    /MANIFEST_HASH/,
  );
  assert.throws(
    () => renderNativeMigration87Sql({ ...input, migrationSha256: "sha256:" + "0".repeat(64) }),
    /MIGRATION_IDENTITY/,
  );
});

test("migration88 is exact87-to88 only and historical drift rejects before SQL", (t) => {
  const input = fixture(t, 88);
  const sql = renderNativeMigration88Sql(input);
  assert.match(sql, /VALUES\(88,/);
  assert.match(sql, /'from_version',87,'to_version',88/);
  assert.equal((sql.match(/INSERT INTO public.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration87Sql(input), /MANIFEST/);
  const first = JSON.parse(readFileSync(resolve(input.migrationRoot, "manifest.json")))
    .migrations[0];
  writeFileSync(resolve(input.migrationRoot, first.filename), "-- drift");
  assert.throws(() => renderNativeMigration88Sql(input), /MIGRATION_HASH/);
});
test("migration88 rejects87-only manifest and unbound target hash", (t) => {
  assert.throws(() => renderNativeMigration88Sql(fixture(t, 87)), /MANIFEST/);
  const input = fixture(t, 88);
  assert.throws(
    () => renderNativeMigration88Sql({ ...input, migrationSha256: "sha256:" + "0".repeat(64) }),
    /MIGRATION_IDENTITY/,
  );
});

test("migration89 requires exact88 predecessor ledger and rejects altered historical bytes", (t) => {
  const input = fixture(t, 89);
  const sql = renderNativeMigration89Sql(input);
  assert.match(sql, /'from_version',88,'to_version',89/);
  assert.match(sql, /VALUES\(89,/);
  assert.equal((sql.match(/INSERT INTO public.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration88Sql(input), /MANIFEST/);
  assert.throws(() => renderNativeMigration89Sql(fixture(t, 88)), /MANIFEST/);
  const prior = JSON.parse(readFileSync(resolve(input.migrationRoot, "manifest.json")))
    .migrations[87];
  writeFileSync(resolve(input.migrationRoot, prior.filename), "-- drift");
  assert.throws(() => renderNativeMigration89Sql(input), /MIGRATION_HASH/);
});

test("migration91 requires exact90 predecessor ledger and renders only the span-key repair", (t) => {
  const input = fixture(t, 91);
  const sql = renderNativeMigration91Sql(input);
  assert.match(sql, /'from_version',90,'to_version',91/);
  assert.match(sql, /VALUES\(91,/);
  assert.equal((sql.match(/INSERT INTO public\.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration90Sql(input), /MANIFEST/);
  assert.throws(() => renderNativeMigration91Sql(fixture(t, 90)), /MANIFEST/);
});

test("migration92 requires exact91 predecessor ledger and renders the SoulX cadence bridge", (t) => {
  const input = fixture(t, 92);
  const sql = renderNativeMigration92Sql(input);
  assert.match(sql, /'from_version',91,'to_version',92/);
  assert.match(sql, /VALUES\(92,/);
  assert.match(sql, /selected_start_ms\/40/);
  assert.match(sql, /selected_end_ms_exclusive\+39/);
  assert.equal((sql.match(/INSERT INTO public\.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration91Sql(input), /MANIFEST/);
  assert.throws(() => renderNativeMigration92Sql(fixture(t, 91)), /MANIFEST/);
});

test("migration93 requires exact92 predecessor ledger and renders only span finalization hash repair", (t) => {
  const input = fixture(t, 93);
  const sql = renderNativeMigration93Sql(input);
  assert.match(sql, /'from_version',92,'to_version',93/);
  assert.match(sql, /VALUES\(93,/);
  assert.match(sql, /expected_request_sha/u);
  assert.equal((sql.match(/INSERT INTO public\.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration92Sql(input), /MANIFEST/);
  assert.throws(() => renderNativeMigration93Sql(fixture(t, 92)), /MANIFEST/);
});

test("migration94 requires exact93 predecessor ledger and renders revision-scoped admission", (t) => {
  const input = fixture(t, 94);
  const sql = renderNativeMigration94Sql(input);
  assert.match(sql, /'from_version',93,'to_version',94/);
  assert.match(sql, /VALUES\(94,/);
  assert.match(sql, /revision\.revision_number DESC,revision\.id DESC/u);
  assert.match(sql, /:revision:'\|\|revision_id::text/u);
  assert.equal((sql.match(/INSERT INTO public\.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration93Sql(input), /MANIFEST/);
  assert.throws(() => renderNativeMigration94Sql(fixture(t, 93)), /MANIFEST/);
});

test("migration95 requires exact94 predecessor ledger and renders candidate renewal", (t) => {
  const input = fixture(t, 95);
  const sql = renderNativeMigration95Sql(input);
  assert.match(sql, /'from_version',94,'to_version',95/);
  assert.match(sql, /hosted_v209_ordinary_dispatch_candidate_renewals/u);
  assert.match(sql, /videoforge_renew_hosted_v209_ordinary_candidate/u);
  assert.equal((sql.match(/INSERT INTO public\.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration94Sql(input), /MANIFEST/);
  assert.throws(() => renderNativeMigration95Sql(fixture(t, 94)), /MANIFEST/);
});

test("migration96 requires exact95 predecessor ledger and renders only the JSONB subtraction repair", (t) => {
  const input = fixture(t, 96);
  const sql = renderNativeMigration96Sql(input);
  assert.match(sql, /'from_version',95,'to_version',96/);
  assert.match(sql, /hosted V2-09 legacy pair JSONB subtraction/u);
  assert.match(sql, /replacement_pattern/u);
  assert.equal((sql.match(/INSERT INTO public\.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration95Sql(input), /MANIFEST/);
  assert.throws(() => renderNativeMigration96Sql(fixture(t, 95)), /MANIFEST/);
});

test("migration97 requires exact96 predecessor ledger and renders only the second renewal boundary", (t) => {
  const input = fixture(t, 97);
  const sql = renderNativeMigration97Sql(input);
  assert.match(sql, /'from_version',96,'to_version',97/);
  assert.match(sql, /renewal_ordinal/u);
  assert.match(sql, /previous_candidate_sha256/u);
  assert.equal((sql.match(/INSERT INTO public\.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration96Sql(input), /MANIFEST/);
  assert.throws(() => renderNativeMigration97Sql(fixture(t, 96)), /MANIFEST/);
});

test("migration98 requires exact97 predecessor ledger and renders only the third renewal boundary", (t) => {
  const input = fixture(t, 98);
  const sql = renderNativeMigration98Sql(input);
  assert.match(sql, /'from_version',97,'to_version',98/);
  assert.match(sql, /renewal_ordinal IN \(1,2,3\)/u);
  assert.match(sql, /db_now,3,candidate\.candidate_sha256,candidate\.approval_id/u);
  assert.equal((sql.match(/INSERT INTO public\.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration97Sql(input), /MANIFEST/);
  assert.throws(() => renderNativeMigration98Sql(fixture(t, 97)), /MANIFEST/);
});

test("migration99 requires exact98 predecessor ledger and renders only the fourth renewal boundary", (t) => {
  const input = fixture(t, 99);
  const sql = renderNativeMigration99Sql(input);
  assert.match(sql, /'from_version',98,'to_version',99/);
  assert.match(sql, /renewal_ordinal IN \(1,2,3,4\)/u);
  assert.match(sql, /renewal_ordinal IN \(2,3,4\)/u);
  assert.match(sql, /previous_candidate_sha256 IS DISTINCT FROM previous_candidate_sha/u);
  assert.match(sql, /db_now,4,candidate\.candidate_sha256,candidate\.approval_id/u);
  assert.equal((sql.match(/INSERT INTO public\.videoforge_schema_migrations/g) || []).length, 1);
  assert.throws(() => renderNativeMigration98Sql(input), /MANIFEST/);
  assert.throws(() => renderNativeMigration99Sql(fixture(t, 98)), /MANIFEST/);
});

test("native execution accepts APPLY_0095 through APPLY_0099 only after operation identity validation", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "v209-native-operation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const credentialPath = resolve(root, "credential");
  writeFileSync(credentialPath, "https://invalid.example/ignored", { mode: 0o600 });
  const input = {
    credentialPath,
    sql: "",
    journalPath: resolve(root, "journal.jsonl"),
    expectedSqlSha256: databaseBytesHash(""),
  };
  assert.throws(
    () => executeNativeDatabaseOnce({ ...input, operation: "APPLY_0095" }),
    /DATABASE_IDENTITY/,
  );
  assert.throws(
    () => executeNativeDatabaseOnce({ ...input, operation: "APPLY_0096" }),
    /DATABASE_IDENTITY/,
  );
  assert.throws(
    () => executeNativeDatabaseOnce({ ...input, operation: "APPLY_0097" }),
    /DATABASE_IDENTITY/,
  );
  assert.throws(
    () => executeNativeDatabaseOnce({ ...input, operation: "APPLY_0098" }),
    /DATABASE_IDENTITY/,
  );
  assert.throws(
    () => executeNativeDatabaseOnce({ ...input, operation: "APPLY_0099" }),
    /DATABASE_IDENTITY/,
  );
});
