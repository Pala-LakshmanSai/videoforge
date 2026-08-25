import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const GRANTS = new URL("../../deploy/v2-06/neon-runtime-grants.sql", import.meta.url);

test("the hosted runtime can append through the exact function but has no direct render-plan writes", async () => {
  const source = await readFile(GRANTS, "utf8");
  assert.match(source, /GRANT SELECT ON hosted_render_plans TO :"runtime_role";/u);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.videoforge_current_account_id\(\)/u);
  assert.match(
    source,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_append_hosted_render_plan\([\s\S]*?uuid, uuid, uuid, uuid, text, jsonb, text[\s\S]*?TO :"runtime_role";/u,
  );
  assert.doesNotMatch(
    source,
    /GRANT\s+[^;\n]*(?:INSERT|UPDATE|DELETE)[^;\n]*\bON\s+hosted_render_plans\b/iu,
  );
  assert.match(source, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"runtime_role";/u);
  assert.match(
    source,
    /never receives direct INSERT, UPDATE, or DELETE[\s\S]*only[\s\S]*write capability/u,
  );
});
