import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

test("V2-13 operator readback canonicalizes function argument OIDs under PGlite", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE FUNCTION public.videoforge_v213_signature_fixture(
        supplied_id uuid,
        supplied_document jsonb,
        supplied_label text,
        supplied_expires_at timestamptz
      ) RETURNS void
      LANGUAGE SQL
      AS $$ SELECT; $$;
    `);
    const result = await database.query(`
      SELECT p.proname||'('||(
        SELECT COALESCE(string_agg(
          CASE format_type(a.type_oid,NULL)
            WHEN 'timestamp with time zone' THEN 'timestamptz'
            ELSE format_type(a.type_oid,NULL)
          END,
          ',' ORDER BY a.ordinality
        ),'')
        FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS a(type_oid,ordinality)
      )||')' AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='videoforge_v213_signature_fixture';
    `);
    assert.deepEqual(
      result.rows.map(({ signature }) => signature),
      ["videoforge_v213_signature_fixture(uuid,jsonb,text,timestamptz)"],
    );
  } finally {
    await database.close();
  }
});
