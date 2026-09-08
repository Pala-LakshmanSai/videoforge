import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  databaseBytesHash,
  renderNativeMigration87Sql,
} from "../../deploy/v2-09/native-replacement-database.mjs";

const migrationRoot = resolve("packages/control-plane/migrations");
const bytes = readFileSync(resolve(migrationRoot, "manifest.json"));
const manifest = JSON.parse(bytes);
const input = {
  migrationRoot,
  manifestSha256: databaseBytesHash(bytes),
  migrationSha256: manifest.migrations[86].sha256,
};
test("replacement applies only87 behind exact86 ledger and transaction lock", () => {
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
test("manifest or migration hash changes prevent SQL generation", () => {
  assert.throws(
    () => renderNativeMigration87Sql({ ...input, manifestSha256: "sha256:" + "0".repeat(64) }),
    /MANIFEST_HASH/,
  );
  assert.throws(
    () => renderNativeMigration87Sql({ ...input, migrationSha256: "sha256:" + "0".repeat(64) }),
    /MIGRATION_IDENTITY/,
  );
});
