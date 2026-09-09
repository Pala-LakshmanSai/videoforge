import assert from "node:assert/strict";
import test from "node:test";

import { IDS } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  sha256,
  uuid,
  withPgcryptoMigratedDatabase,
} from "./support/pglite.mjs";

const candidateReaderSignatures = [
  "videoforge_accept_hosted_v209_terminal_output(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamp with time zone)",
  "videoforge_assert_hosted_v209_ordinary_avatar_source(uuid,uuid,uuid)",
  "videoforge_has_hosted_v209_ordinary_candidate(uuid,uuid,uuid)",
  "videoforge_materialize_hosted_v209_ordinary_dispatch(uuid,uuid,uuid,uuid)",
  "videoforge_read_hosted_v209_ready_render_inputs_v1(uuid,uuid,uuid)",
  "videoforge_read_hosted_v209_terminal_lineage(uuid,uuid,uuid,text,text)",
  "videoforge_resume_hosted_v209_ordinary_lane_materialization(uuid,uuid,uuid,text)",
  "videoforge_v209_ordinary_commit_lane_legacy_0081(uuid,uuid,uuid,text,uuid,text,jsonb,text)",
  "videoforge_v209_ordinary_load_lane_legacy_0081(uuid,uuid,uuid,text)",
  "videoforge_v209_ordinary_materialize_legacy_0081(uuid,uuid,uuid,uuid)",
  "videoforge_v209_ordinary_pair_legacy_0081(uuid,uuid,uuid,uuid,jsonb)",
];

test("0095 installs an append-only renewal overlay and private guarded boundary", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor, sources }) => {
    assert.equal(sources.at(-1)?.version, 95);
    assert.equal(
      sources.at(-1)?.filename,
      "0095_hosted_v209_same_generation_candidate_renewal.sql",
    );

    const surface = await executor.query(
      `SELECT c.relrowsecurity,c.relforcerowsecurity,
              EXISTS (SELECT 1 FROM pg_trigger t
                       WHERE t.tgrelid=c.oid AND t.tgname='hosted_v209_ordinary_dispatch_candidate_renewals_append_only')
                AS has_append_only,
              (SELECT count(*)::integer FROM pg_policy policy WHERE policy.polrelid=c.oid) AS policies
         FROM pg_class c
        WHERE c.oid='public.hosted_v209_ordinary_dispatch_candidate_renewals'::regclass`,
    );
    assert.deepEqual(surface.rows, [
      { relrowsecurity: true, relforcerowsecurity: true, has_append_only: true, policies: 1 },
    ]);

    const routines = await executor.query(
      `SELECT p.oid::regprocedure::text AS signature,p.prosecdef,
              has_function_privilege('public',p.oid,'EXECUTE') AS public_execute,
              pg_get_functiondef(p.oid) AS definition
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.proname IN ('videoforge_effective_hosted_v209_candidate',
                            'videoforge_renew_hosted_v209_ordinary_candidate')
        ORDER BY signature`,
    );
    assert.equal(routines.rows.length, 2);
    assert.ok(routines.rows.every((row) => row.prosecdef === true));
    assert.ok(routines.rows.every((row) => row.public_execute === false));
    assert.ok(
      routines.rows.every((row) =>
        /SET search_path TO 'public', 'pg_catalog'/u.test(row.definition),
      ),
    );
    assert.match(
      routines.rows.find((row) => row.signature.startsWith("videoforge_renew_"))?.definition ?? "",
      /version\s*<>\s*supplied_expected_lease_version|lease CAS failed/u,
    );
  });
});

test("0095 routes every existing candidate reader through the effective renewal", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    const definitions = await executor.query(
      `SELECT p.oid::regprocedure::text AS signature,pg_get_functiondef(p.oid) AS definition
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.oid::regprocedure::text=ANY($1::text[])
        ORDER BY signature`,
      [candidateReaderSignatures],
    );
    assert.equal(definitions.rows.length, candidateReaderSignatures.length);
    for (const row of definitions.rows) {
      assert.ok(
        row.definition.includes("hosted_v209_ordinary_dispatch_candidates_effective") ||
          row.definition.includes("videoforge_effective_hosted_v209_candidate"),
        `${row.signature} still reads the original candidate without renewal resolution`,
      );
    }

    const unexpected = await executor.query(
      `SELECT p.oid::regprocedure::text AS signature
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind='f'
          AND pg_get_functiondef(p.oid) LIKE '%public.hosted_v209_ordinary_dispatch_candidates%'
          AND p.oid::regprocedure::text <> ALL($1::text[])
          AND p.oid::regprocedure::text NOT IN (
            'videoforge_effective_hosted_v209_candidate(uuid,uuid,uuid)',
            'videoforge_renew_hosted_v209_ordinary_candidate(uuid,uuid,uuid,uuid,uuid,uuid,integer,integer,text,uuid,uuid)')
        ORDER BY signature`,
      [candidateReaderSignatures],
    );
    assert.deepEqual(unexpected.rows, []);
  });
});

test("0095 rejects an unbound renewal before any approval, lease, or provider rows are written", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    await executor.query(`SELECT set_config('videoforge.account_id',$1,false)`, [IDS.accountA]);
    const args = [
      IDS.accountA,
      IDS.workspaceA,
      IDS.userA,
      IDS.projectA,
      uuid(95_001),
      uuid(95_002),
      1,
      1,
      sha256("unbound-original-candidate"),
      uuid(95_003),
      uuid(95_004),
    ];
    await expectDatabaseError(
      () =>
        executor.query(
          `SELECT public.videoforge_renew_hosted_v209_ordinary_candidate(
             $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::integer,$8::integer,
             $9::text,$10::uuid,$11::uuid)`,
          args,
        ),
      "42501",
    );
    const counts = await executor.query(
      `SELECT
         (SELECT count(*)::integer FROM hosted_v209_ordinary_dispatch_candidate_renewals) AS renewals,
         (SELECT count(*)::integer FROM hosted_paid_dispatch_approvals) AS approvals,
         (SELECT count(*)::integer FROM provider_workload_leases) AS leases,
         (SELECT count(*)::integer FROM serverless_attempts) AS attempts,
         (SELECT count(*)::integer FROM serverless_dispatch_outbox) AS outboxes`,
    );
    assert.deepEqual(counts.rows, [
      { renewals: 0, approvals: 0, leases: 0, attempts: 0, outboxes: 0 },
    ]);
  });
});
