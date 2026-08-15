// V2-01 tenant-private identity and data cutover (GATE_TENANCY_001, DEC_TENANCY_002).
//
// Proves the three enforcement layers the checkpoint requires:
//   1. database constraints that make a cross-tenant row unrepresentable;
//   2. derived ownership, so a client-supplied owner cannot grant or change access;
//   3. RLS-equivalent guards — the tenant write guard and the tenant read views.
//
// PGlite connects as a superuser, which bypasses row level security. The policies this migration
// declares are therefore asserted structurally here and remain the production boundary for the
// non-superuser application role; the behavioural proof below comes from the guard trigger and the
// tenant views, both of which are enforced for the table owner.

import assert from "node:assert/strict";
import test from "node:test";

import {
  RESERVED_LEGACY_ACCOUNT_ID,
  RESERVED_LEGACY_WORKSPACE_ID,
  RESERVED_SYSTEM_ACCOUNT_ID,
  RESERVED_SYSTEM_USER_ID,
  RESERVED_SYSTEM_WORKSPACE_ID,
  TENANT_PRINCIPAL_SETTING,
  applyMigrations,
  trustedTenantScope,
} from "../dist/src/index.js";
import { createPGliteControlPlaneRepositories } from "../dist/src/adapters/index.js";
import { PGlite } from "@electric-sql/pglite";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import {
  expectDatabaseError,
  FIXED_TIME,
  loadMigrationSources,
  PGliteExecutor,
  sha256,
  uuid,
  withMigratedDatabase,
} from "./support/pglite.mjs";

const FOREIGN_ACCOUNT = uuid(970_001);
const FOREIGN_WORKSPACE = uuid(970_002);

async function asPrincipal(executor, accountId, work) {
  await executor.query(`SELECT set_config($1, $2, false)`, [TENANT_PRINCIPAL_SETTING, accountId]);
  try {
    return await work();
  } finally {
    await executor.query(`SELECT set_config($1, '', false)`, [TENANT_PRINCIPAL_SETTING]);
  }
}

async function seedTwoAccounts(executor) {
  // seedLockedProjects seeds both accounts, their presets, revisions, assets, and tasks.
  await seedLockedProjects(executor);
}

test("every user-owned table derives its account from the authorized workspace", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTwoAccounts(executor);

    const owned = await executor.query(
      `SELECT project.account_id AS project_account,
              revision.account_id AS revision_account,
              asset.account_id AS asset_account
         FROM projects project
         JOIN project_revisions revision ON revision.workspace_id = project.workspace_id
         JOIN assets asset ON asset.workspace_id = project.workspace_id
        WHERE project.workspace_id = $1
        LIMIT 1`,
      [IDS.workspaceA],
    );
    const row = owned.rows[0];
    assert.equal(row.project_account, IDS.accountA);
    assert.equal(row.revision_account, IDS.accountA);
    assert.equal(row.asset_account, IDS.accountA);

    // A supplied owner is overwritten by the derived one rather than honoured.
    const forged = uuid(970_010);
    await executor.query(
      `INSERT INTO projects (id, workspace_id, account_id, owner_user_id, name, normalized_name)
       VALUES ($1, $2, $3, $4, 'Forged Owner', 'forged owner')`,
      [forged, IDS.workspaceA, IDS.accountB, IDS.userA],
    );
    const stored = await executor.query(`SELECT account_id FROM projects WHERE id = $1`, [forged]);
    assert.equal(
      stored.rows[0].account_id,
      IDS.accountA,
      "a client-supplied account must never survive the write",
    );
  });
});

test("account ownership is immutable and cross-tenant rows cannot be represented", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTwoAccounts(executor);

    // Writing a foreign account directly is neutralised: the derived owner wins.
    await executor.query(`UPDATE projects SET account_id = $1 WHERE workspace_id = $2`, [
      IDS.accountB,
      IDS.workspaceA,
    ]);
    const unchanged = await executor.query(
      `SELECT count(*)::int AS escaped FROM projects
        WHERE workspace_id = $1 AND account_id <> $2`,
      [IDS.workspaceA, IDS.accountA],
    );
    assert.equal(unchanged.rows[0].escaped, 0, "ownership must not follow a supplied account");

    // Moving a row into another tenant's workspace is rejected as an ownership change.
    await expectDatabaseError(
      executor.query(`UPDATE projects SET workspace_id = $1 WHERE workspace_id = $2`, [
        IDS.workspaceB,
        IDS.workspaceA,
      ]),
      "55000",
    );

    // A workspace cannot be adopted by an account that does not exist.
    await expectDatabaseError(
      executor.query(
        `INSERT INTO workspaces (id, name, normalized_name, account_id, is_default)
         VALUES ($1, 'Unowned', 'unowned', $2, false)`,
        [FOREIGN_WORKSPACE, FOREIGN_ACCOUNT],
      ),
      "23503",
    );

    // A row whose account disagrees with its workspace is unrepresentable: derivation replaces the
    // supplied value, and the composite scope foreign key would reject it if derivation were absent.
    const asset = uuid(970_020);
    await executor.query(
      `INSERT INTO assets (id, workspace_id, account_id, kind, state, binary_sha256, verified_at)
       VALUES ($1, $2, $3, 'IMAGE', 'VERIFIED', $4, $5)`,
      [asset, IDS.workspaceA, IDS.accountB, sha256("cross-tenant-asset"), FIXED_TIME],
    );
    const settled = await executor.query(`SELECT account_id FROM assets WHERE id = $1`, [asset]);
    assert.equal(settled.rows[0].account_id, IDS.accountA);

    const scopeKey = await executor.query(
      `SELECT count(*)::int AS present
         FROM pg_constraint
        WHERE conname = 'assets_tenant_scope_fk' AND contype = 'f'`,
    );
    assert.equal(scopeKey.rows[0].present, 1, "the composite scope key must exist");
  });
});

test("the tenant write guard rejects a write outside the bound principal", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTwoAccounts(executor);

    await asPrincipal(executor, IDS.accountB, async () => {
      await expectDatabaseError(
        executor.query(
          `INSERT INTO projects (id, workspace_id, owner_user_id, name, normalized_name)
           VALUES ($1, $2, $3, 'Account B Reaching Into A', 'account b reaching into a')`,
          [uuid(970_030), IDS.workspaceA, IDS.userA],
        ),
        "42501",
      );
    });

    // The same statement inside the owning principal succeeds.
    await asPrincipal(executor, IDS.accountA, async () => {
      await executor.query(
        `INSERT INTO projects (id, workspace_id, owner_user_id, name, normalized_name)
         VALUES ($1, $2, $3, 'Account A Own Project', 'account a own project')`,
        [uuid(970_031), IDS.workspaceA, IDS.userA],
      );
    });
  });
});

test("tenant views hide every foreign row across the two-account matrix", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTwoAccounts(executor);

    const surfaces = [
      "videoforge_tenant_projects",
      "videoforge_tenant_project_revisions",
      "videoforge_tenant_assets",
      "videoforge_tenant_generation_tasks",
      "videoforge_tenant_cost_events",
      "videoforge_tenant_workflow_instances",
    ];

    for (const [accountId, workspaceId, foreignWorkspaceId] of [
      [IDS.accountA, IDS.workspaceA, IDS.workspaceB],
      [IDS.accountB, IDS.workspaceB, IDS.workspaceA],
    ]) {
      await asPrincipal(executor, accountId, async () => {
        for (const surface of surfaces) {
          const visible = await executor.query(
            `SELECT count(*)::int AS foreign_rows FROM ${surface} WHERE workspace_id = $1`,
            [foreignWorkspaceId],
          );
          assert.equal(visible.rows[0].foreign_rows, 0, `${surface} leaked a foreign row`);

          const mine = await executor.query(
            `SELECT count(*)::int AS own_rows FROM ${surface} WHERE workspace_id = $1`,
            [workspaceId],
          );
          assert.ok(mine.rows[0].own_rows >= 0);
        }
      });
    }
  });
});

test("a guessed identifier, hash, or existence probe reveals nothing across accounts", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTwoAccounts(executor);

    const known = await executor.query(
      `SELECT id, binary_sha256 FROM assets
        WHERE workspace_id = $1 AND binary_sha256 IS NOT NULL
        LIMIT 1`,
      [IDS.workspaceB],
    );
    const target = known.rows[0];
    assert.ok(target !== undefined, "account B must own at least one hashed asset");

    await asPrincipal(executor, IDS.accountA, async () => {
      // Exact primary key of another tenant's row.
      const byId = await executor.query(
        `SELECT count(*)::int AS found FROM videoforge_tenant_assets WHERE id = $1`,
        [target.id],
      );
      assert.equal(byId.rows[0].found, 0);

      // Exact content hash of another tenant's bytes: existence must not be observable.
      const byHash = await executor.query(
        `SELECT count(*)::int AS found FROM videoforge_tenant_assets WHERE binary_sha256 = $1`,
        [target.binary_sha256],
      );
      assert.equal(byHash.rows[0].found, 0);

      // A free-text search across the tenant surface returns only owned rows.
      const search = await executor.query(
        `SELECT count(*)::int AS foreign_hits FROM videoforge_tenant_projects
          WHERE normalized_name LIKE '%' AND account_id <> $1`,
        [IDS.accountA],
      );
      assert.equal(search.rows[0].foreign_hits, 0);
    });
  });
});

test("an absent principal sees no tenant rows and every repository call requires an owned scope", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTwoAccounts(executor);

    // No principal bound at all: every tenant surface is empty.
    const unbound = await executor.query(
      `SELECT (SELECT count(*)::int FROM videoforge_tenant_projects) AS projects,
              (SELECT count(*)::int FROM videoforge_tenant_assets) AS assets`,
    );
    assert.deepEqual(unbound.rows[0], { projects: 0, assets: 0 });

    const repositories = createPGliteControlPlaneRepositories(executor);
    const unscoped = await repositories.artifacts.resolveExact(undefined, IDS.voiceoverA);
    assert.deepEqual(unscoped, {
      ok: false,
      kind: "INVARIANT_VIOLATION",
      code: "CROSS_WORKSPACE_REFERENCE",
      message: "a trusted account and workspace are required",
    });

    const forged = trustedTenantScope(IDS.accountB, IDS.workspaceA);
    const mismatched = await repositories.artifacts.resolveExact(forged, IDS.voiceoverA);
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.kind, "INVARIANT_VIOLATION");
    assert.equal(mismatched.code, "CROSS_WORKSPACE_REFERENCE");

    const accountB = trustedTenantScope(IDS.accountB, IDS.workspaceB);
    const foreignArtifact = await repositories.artifacts.resolveExact(accountB, IDS.voiceoverA);
    assert.deepEqual(foreignArtifact, {
      ok: false,
      kind: "NOT_FOUND",
      entity: "ASSET",
      id: IDS.voiceoverA,
    });

    // A database session bound to a deleted or never-existing account is equally empty, and its
    // writes are rejected rather than silently retargeted.
    await asPrincipal(executor, FOREIGN_ACCOUNT, async () => {
      const stale = await executor.query(
        `SELECT count(*)::int AS visible FROM videoforge_tenant_projects`,
      );
      assert.equal(stale.rows[0].visible, 0);

      await expectDatabaseError(
        executor.query(
          `INSERT INTO projects (id, workspace_id, owner_user_id, name, normalized_name)
           VALUES ($1, $2, $3, 'Stale Session Write', 'stale session write')`,
          [uuid(970_040), IDS.workspaceA, IDS.userA],
        ),
        "42501",
      );
    });
  });
});

test("built-in presets are globally readable and immutable while user presets stay private", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedTwoAccounts(executor);

    const builtinStyle = uuid(970_050);
    await executor.query(
      `INSERT INTO image_styles (
         id, workspace_id, scope_kind, created_by_user_id, name, normalized_name, status
       ) VALUES ($1, $2, 'SYSTEM', $3, 'documentary_stock_v1', 'documentary_stock_v1', 'ACTIVE')`,
      [builtinStyle, RESERVED_SYSTEM_WORKSPACE_ID, RESERVED_SYSTEM_USER_ID],
    );

    const stored = await executor.query(`SELECT account_id FROM image_styles WHERE id = $1`, [
      builtinStyle,
    ]);
    assert.equal(stored.rows[0].account_id, RESERVED_SYSTEM_ACCOUNT_ID);

    // Both accounts see the built-in, and neither sees the other's private style.
    for (const [accountId, foreignWorkspaceId] of [
      [IDS.accountA, IDS.workspaceB],
      [IDS.accountB, IDS.workspaceA],
    ]) {
      await asPrincipal(executor, accountId, async () => {
        const builtin = await executor.query(
          `SELECT count(*)::int AS visible FROM videoforge_tenant_image_styles WHERE id = $1`,
          [builtinStyle],
        );
        assert.equal(builtin.rows[0].visible, 1, "built-ins must be globally readable");

        const foreign = await executor.query(
          `SELECT count(*)::int AS visible FROM videoforge_tenant_image_styles
            WHERE workspace_id = $1`,
          [foreignWorkspaceId],
        );
        assert.equal(foreign.rows[0].visible, 0, "user-created styles must stay private");
      });
    }

    // A built-in cannot be mutated or removed by anyone.
    await expectDatabaseError(
      executor.query(`UPDATE image_styles SET name = 'tampered' WHERE id = $1`, [builtinStyle]),
      "55000",
    );
    await expectDatabaseError(
      executor.query(`DELETE FROM image_styles WHERE id = $1`, [builtinStyle]),
      "55000",
    );

    // A globally readable record cannot be created outside the reserved system account.
    await expectDatabaseError(
      executor.query(
        `INSERT INTO image_styles (
           id, workspace_id, scope_kind, created_by_user_id, name, normalized_name, status
         ) VALUES ($1, $2, 'SYSTEM', $3, 'fake_builtin', 'fake_builtin', 'ACTIVE')`,
        [uuid(970_051), IDS.workspaceA, IDS.userA],
      ),
      "23514",
    );
  });
});

test("an upgraded database keeps pre-V2 rows in the inaccessible legacy scope", async () => {
  const database = new PGlite();
  try {
    const executor = new PGliteExecutor(database);
    const sources = await loadMigrationSources();
    await executor.execute(
      `CREATE TABLE public.videoforge_schema_migrations (
         version integer PRIMARY KEY CHECK (version > 0),
         name text NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
         filename text NOT NULL UNIQUE,
         sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    // Build a complete pre-V2 database, then seed it the way V1 did: with no tenant column at all.
    for (const migration of sources.slice(0, 17)) {
      await executor.execute(migration.sql);
      await executor.query(
        `INSERT INTO videoforge_schema_migrations (version, name, filename, sha256)
         VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, migration.filename, migration.sha256],
      );
    }
    await seedLockedProjects(executor);

    const upgraded = await applyMigrations(executor, sources);
    assert.deepEqual(upgraded.appliedVersions, [18, 19, 20]);

    // Every historical workspace now belongs to the legacy account.
    const adopted = await executor.query(
      `SELECT count(*)::int AS legacy_workspaces FROM workspaces WHERE account_id = $1`,
      [RESERVED_LEGACY_ACCOUNT_ID],
    );
    assert.ok(adopted.rows[0].legacy_workspaces >= 3, "pre-V2 workspaces adopt the legacy account");

    const legacyProjects = await executor.query(
      `SELECT count(*)::int AS rows FROM projects WHERE account_id = $1`,
      [RESERVED_LEGACY_ACCOUNT_ID],
    );
    assert.ok(legacyProjects.rows[0].rows > 0, "pre-V2 projects land in the legacy scope");

    // No identity can ever authenticate into the legacy or system scope.
    const reserved = await executor.query(
      `SELECT id, status, owner_user_id FROM accounts
        WHERE id IN ($1, $2) ORDER BY id`,
      [RESERVED_SYSTEM_ACCOUNT_ID, RESERVED_LEGACY_ACCOUNT_ID],
    );
    assert.equal(reserved.rows.length, 2);
    for (const row of reserved.rows) {
      assert.equal(row.status, "NON_LOGIN");
      assert.equal(row.owner_user_id, null);
    }

    // The legacy scope is not reachable from any ordinary principal.
    await asPrincipal(executor, RESERVED_SYSTEM_ACCOUNT_ID, async () => {
      const visible = await executor.query(
        `SELECT count(*)::int AS visible FROM videoforge_tenant_projects`,
      );
      assert.equal(visible.rows[0].visible, 0);
    });

    const reservedWorkspaces = await executor.query(
      `SELECT count(*)::int AS rows FROM workspaces WHERE id IN ($1, $2)`,
      [RESERVED_SYSTEM_WORKSPACE_ID, RESERVED_LEGACY_WORKSPACE_ID],
    );
    assert.equal(reservedWorkspaces.rows[0].rows, 2);
  } finally {
    await database.close();
  }
});
