import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_PRINCIPAL_SETTING } from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { expectDatabaseError, sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";

const RUNTIME_ROLE = "videoforge_v209_runtime_dc9612d6";
const RECONCILER_ROLE = "videoforge_v209_reconciler_dc9612d6";

async function insertProfile(executor, { accountId, workspaceId, id, revision }) {
  await executor.query(
    `INSERT INTO public.execution_profiles (
       id, account_id, workspace_id, name, revision, lane, state, dispatch_target,
       configuration, configuration_hash, maximum_rate_micro_usd, checked_at
     ) VALUES (
       $1,$2,$3,'Hosted Runware GPT-6 Luna scene prompts',$4,'PROMPT','TESTED','RUNWARE',
       '{"model":"openai:gpt@6-luna"}'::jsonb,$5,8000000,clock_timestamp()
     )`,
    [id, accountId, workspaceId, revision, sha256(`profile-${id}`)],
  );
}

test("0286 grants only profile id and revision, with account RLS for runtime readers", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    await executor.query(`SELECT set_config($1,$2,false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountA,
    ]);
    const profile8 = uuid(286_801);
    const profile9 = uuid(286_802);
    const foreignProfile9 = uuid(286_803);
    await insertProfile(executor, {
      accountId: IDS.accountA,
      workspaceId: IDS.workspaceA,
      id: profile8,
      revision: 8,
    });
    await insertProfile(executor, {
      accountId: IDS.accountA,
      workspaceId: IDS.workspaceA,
      id: profile9,
      revision: 9,
    });
    await executor.query(`SELECT set_config($1,$2,false)`, [
      TENANT_PRINCIPAL_SETTING,
      IDS.accountB,
    ]);
    await insertProfile(executor, {
      accountId: IDS.accountB,
      workspaceId: IDS.workspaceB,
      id: foreignProfile9,
      revision: 9,
    });

    const roles = await executor.query(
      `SELECT role.rolname,role.rolsuper,role.rolbypassrls
         FROM pg_roles role WHERE role.rolname = ANY($1::text[]) ORDER BY role.rolname`,
      [[RUNTIME_ROLE, RECONCILER_ROLE]],
    );
    assert.equal(roles.rows.length, 2);
    assert.ok(roles.rows.every((role) => !role.rolsuper && !role.rolbypassrls));

    for (const role of [RUNTIME_ROLE, RECONCILER_ROLE]) {
      await executor.transaction(async (transaction) => {
        await transaction.query(`SET LOCAL ROLE ${role}`);
        await transaction.query(`SELECT set_config($1,$2,true)`, [
          TENANT_PRINCIPAL_SETTING,
          IDS.accountA,
        ]);
        const privilege = await transaction.query(
          `SELECT has_table_privilege(current_user,'public.execution_profiles','SELECT') AS table_select,
                  has_column_privilege(current_user,'public.execution_profiles','id','SELECT') AS id_select,
                  has_column_privilege(current_user,'public.execution_profiles','revision','SELECT') AS revision_select,
                  has_column_privilege(current_user,'public.execution_profiles','configuration','SELECT') AS config_select,
                  has_column_privilege(current_user,'public.execution_profiles','account_id','SELECT') AS account_select,
                  relation.relrowsecurity,relation.relforcerowsecurity
             FROM pg_class relation JOIN pg_namespace schema ON schema.oid=relation.relnamespace
            WHERE schema.nspname='public' AND relation.relname='execution_profiles'`,
        );
        assert.deepEqual(privilege.rows[0], {
          table_select: false,
          id_select: true,
          revision_select: true,
          config_select: false,
          account_select: false,
          relrowsecurity: true,
          relforcerowsecurity: true,
        });

        const ownRows = await transaction.query(
          `SELECT profile.revision FROM public.execution_profiles profile
            WHERE profile.id IN ($1::uuid,$2::uuid) ORDER BY profile.revision`,
          [profile8, profile9],
        );
        assert.deepEqual(
          ownRows.rows.map((row) => row.revision),
          [8, 9],
        );
        const foreignRows = await transaction.query(
          `SELECT profile.revision FROM public.execution_profiles profile WHERE profile.id=$1::uuid`,
          [foreignProfile9],
        );
        assert.deepEqual(foreignRows.rows, []);

        await transaction.query("SAVEPOINT deny_profile_configuration");
        await expectDatabaseError(
          () =>
            transaction.query(
              "SELECT configuration FROM public.execution_profiles WHERE id=$1::uuid",
              [profile8],
            ),
          "42501",
        );
        await transaction.query("ROLLBACK TO SAVEPOINT deny_profile_configuration");
      });
    }
  });
});
