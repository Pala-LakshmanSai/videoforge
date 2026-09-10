import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/0117_hosted_v209_parallel_pair_dispatch.sql",
  import.meta.url,
);
const runtimeGrantsUrl = new URL(
  "../../../deploy/v2-06/neon-runtime-grants.sql",
  import.meta.url,
);
const v209GrantsUrl = new URL(
  "../../../deploy/v2-09/neon-v209-runtime-grants.sql",
  import.meta.url,
);

test("0117 defines the atomic two-lane send transition and narrow grants", async () => {
  const [sql, runtimeGrants, v209Grants] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(runtimeGrantsUrl, "utf8"),
    readFile(v209GrantsUrl, "utf8"),
  ]);

  assert.match(sql, /CREATE FUNCTION public\.videoforge_begin_hosted_pair_parallel_send/u);
  assert.match(sql, /CREATE FUNCTION public\.videoforge_finish_hosted_pair_parallel_send/u);
  assert.match(sql, /'BOTH_SENT'/u);
  assert.match(sql, /'MAGE_ASSIGNED'/u);
  assert.match(sql, /'SOULX_ASSIGNED'/u);
  assert.match(sql, /SET state='SENT',send_attempt_count=1/u);
  assert.match(sql, /UPDATE public\.hosted_pair_runtime_states SET phase='BOTH_SENT'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.videoforge_begin_hosted_pair_parallel_send/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.videoforge_finish_hosted_pair_parallel_send/u);
  assert.match(
    runtimeGrants,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_begin_hosted_pair_parallel_send/u,
  );
  assert.match(
    runtimeGrants,
    /GRANT EXECUTE ON FUNCTION public\.videoforge_finish_hosted_pair_parallel_send/u,
  );
  assert.match(
    v209Grants,
    /videoforge_begin_hosted_pair_parallel_send\(uuid,uuid,uuid,uuid,text,uuid,text\)/u,
  );
  assert.match(
    v209Grants,
    /videoforge_finish_hosted_pair_parallel_send\(uuid,uuid,uuid,text,text,text,uuid,text\)/u,
  );
});
