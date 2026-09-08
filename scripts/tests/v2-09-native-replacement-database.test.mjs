import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  databaseBytesHash,
  renderNativeMigration87Sql,
  renderNativeMigration88Sql,
} from "../../deploy/v2-09/native-replacement-database.mjs";

function fixture(t, target) {
  const sourceRoot = resolve("packages/control-plane/migrations");
  const manifest = JSON.parse(readFileSync(resolve(sourceRoot, "manifest.json")));
  const migrationRoot = mkdtempSync(resolve(tmpdir(), "v209-migration-render-"));
  t.after(() => rmSync(migrationRoot, { recursive: true, force: true }));
  manifest.migrations = manifest.migrations.slice(0, Math.min(target, 87));
  for (const e of manifest.migrations)
    copyFileSync(resolve(sourceRoot, e.filename), resolve(migrationRoot, e.filename));
  if (target === 88) {
    // Renderer contract fixture only; actual0088 SQL is verified by its dedicated PostgreSQL test.
    const sql = "DO $$ BEGIN PERFORM 1; END $$;\n";
    const entry = {
      version: 88,
      name: "native_helper_acl_fixture",
      filename: "0088_native_helper_acl_fixture.sql",
      sha256: databaseBytesHash(sql),
    };
    manifest.migrations.push(entry);
    writeFileSync(resolve(migrationRoot, entry.filename), sql);
  }
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
