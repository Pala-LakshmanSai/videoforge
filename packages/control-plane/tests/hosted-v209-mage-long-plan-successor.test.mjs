import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrationSliceThrough, PGliteExecutor } from "./support/pglite.mjs";

const mageImage = "sha256:a74a622400ab21a51f270176ce0df1e7ea292f1ded999abe6193b4c40bb1fde3";
const mageSource = "ad6258ae079762c05434048c76072dd656e378cd";
const mageConfig = "sha256:2e2f7cf2fab2d4f36241d0c44955182dddb19e5ebc825524027ef11a872bef97";
const anonymousProof = "sha256:baf62421dfc739fc0b381e8a9c6f7d8d0bbd598f985bf152aa7e5f7b2885d875";
const filename = "0134_hosted_v209_mage_long_plan_successor.sql";

test("Mage long-plan successor pins published bytes and preserves the prior function on rollback", async () => {
  const sql = await readFile(new URL("../migrations/" + filename, import.meta.url), "utf8");
  const manifest = JSON.parse(
    await readFile(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
  );
  assert.equal(
    manifest.migrations.find((entry) => entry.version === 134).sha256,
    "sha256:" + createHash("sha256").update(sql).digest("hex"),
  );
  for (const pin of [mageImage, mageSource, mageConfig, anonymousProof])
    assert.ok(sql.includes(pin));
  assert.ok(
    sql.includes("sha256:f67287feeef2a8ff16efd48d142125f6c3ee1863bde5b92aa74f80b7e741cd35"),
  );
  const proofBytes = await readFile(
    new URL(
      "../../../project-context/evidence/acceptance/VF-10-09/2026-09-15-long-video-audit/mage-anonymous-publication.json",
      import.meta.url,
    ),
  );
  assert.equal("sha256:" + createHash("sha256").update(proofBytes).digest("hex"), anonymousProof);
  const database = new PGlite();
  try {
    await applyMigrationSliceThrough(new PGliteExecutor(database), 133);
    const definition = async () =>
      (
        await database.query(
          "SELECT pg_get_functiondef('public.videoforge_import_hosted_v209_qualified_activation(jsonb)'::regprocedure) AS body",
        )
      ).rows[0].body;
    const before = await definition();
    assert.ok(
      before.includes("sha256:5aff610dd00075ac0601eda9dbd3caf07d7ebf96a73fca849d075a215e4e7161"),
    );
    await database.exec("BEGIN");
    await database.exec(sql);
    const after = await definition();
    for (const pin of [mageImage, mageSource, mageConfig, anonymousProof])
      assert.ok(after.includes(pin));
    await database.exec("ROLLBACK");
    assert.equal(await definition(), before);
  } finally {
    await database.close();
  }
});
