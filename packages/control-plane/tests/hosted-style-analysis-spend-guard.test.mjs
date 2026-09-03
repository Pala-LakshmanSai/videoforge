import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_PRINCIPAL_SETTING } from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { expectDatabaseError, sha256, withMigratedDatabase } from "./support/pglite.mjs";

const RUN_ID = "00000000-0000-4000-8000-000000980001";

test("0052 reserves one bounded Runware Gemini dispatch and durably finishes it", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query(`SELECT set_config($1, $2, false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountA,
    ]);
    await executor.query(
      `INSERT INTO image_style_versions (
         id, account_id, workspace_id, style_id, version_number, state, scope_kind,
         disclosure_attested_by_user_id
       ) VALUES ($1,$2,$3,$4,2,'DRAFT','WORKSPACE',$5)`,
      [IDS.styleDraftA, IDS.accountA, IDS.workspaceA, IDS.styleA, IDS.userA],
    );
    const requestHash = sha256("runware-gemini-style-request");
    const reserved = await executor.query(
      `SELECT * FROM public.videoforge_reserve_hosted_style_analysis($1,$2,$3)`,
      [IDS.styleDraftA, requestHash, RUN_ID],
    );
    assert.deepEqual(reserved.rows[0], {
      run_id: RUN_ID,
      run_state: "RESERVED",
      dispatch_allowed: true,
      reserved_cost_micro_usd: 20_000,
    });
    const replay = await executor.query(
      `SELECT * FROM public.videoforge_reserve_hosted_style_analysis($1,$2,$3)`,
      [IDS.styleDraftA, requestHash, RUN_ID],
    );
    assert.equal(replay.rows[0].dispatch_allowed, false);

    const finished = await executor.query(
      `SELECT public.videoforge_finish_hosted_style_analysis($1,'SUCCEEDED',$2,$3,100,200,308) AS finished`,
      [RUN_ID, sha256("provider-response"), "provider-request-1"],
    );
    assert.equal(finished.rows[0].finished, true);
    const receipt = await executor.query(
      `SELECT state, reserved_cost_micro_usd, reported_cost_micro_usd, prompt_tokens,
              completion_tokens, provider_reference
         FROM hosted_style_analysis_runs WHERE id = $1`,
      [RUN_ID],
    );
    assert.deepEqual(receipt.rows[0], {
      state: "SUCCEEDED",
      reserved_cost_micro_usd: 20_000,
      reported_cost_micro_usd: 308,
      prompt_tokens: 100,
      completion_tokens: 200,
      provider_reference: "provider-request-1",
    });

    await executor.query(`SELECT set_config($1, $2, false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountB,
    ]);
    await expectDatabaseError(
      () =>
        executor.query(`SELECT * FROM public.videoforge_reserve_hosted_style_analysis($1,$2,$3)`, [
          IDS.styleDraftA,
          requestHash,
          "00000000-0000-4000-8000-000000980002",
        ]),
      "42501",
    );
  });
});
