import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { validateProductionPairBoundary } from "../../deploy/v2-13/validate-production-pair-boundary.mjs";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const validator = path.resolve(root, "deploy/v2-13/validate-production-pair-boundary.mjs");

async function fixture() {
  const [bindings, reconcilerSql, runtimeSql, wrangler] = await Promise.all([
    readFile(
      path.resolve(root, "deploy/v2-13/production-pair-bindings.template.json"),
      "utf8",
    ).then(JSON.parse),
    readFile(path.resolve(root, "deploy/v2-13/neon-pair-reconciler-grants.sql"), "utf8"),
    readFile(path.resolve(root, "deploy/v2-06/neon-runtime-grants.sql"), "utf8"),
    readFile(path.resolve(root, "apps/web/wrangler.production.jsonc"), "utf8"),
  ]);
  return { bindings, reconcilerSql, runtimeSql, wrangler };
}

test("production pair boundary is disabled, role-separated, secret-free, and provider-free", async () => {
  const result = spawnSync(process.execPath, [validator], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schema_version: "videoforge-v2-13-production-pair-boundary-validation/v1",
    state: "DISABLED_UNQUALIFIED",
    runtime_can_settle: false,
    reconciler_can_settle: true,
    provider_calls: 0,
    credential_reads: 0,
    external_spend_usd: 0,
  });
});

test("boundary rejects runtime settlement, shared roles, plaintext secrets, and enabled transport", async () => {
  const source = await fixture();
  assert.throws(
    () =>
      validateProductionPairBoundary({
        ...source,
        runtimeSql: `${source.runtimeSql}\nGRANT EXECUTE ON FUNCTION public.videoforge_settle_hosted_pair_cleanup(uuid,uuid,uuid,jsonb) TO :"runtime_role";`,
      }),
    /bypass atomic v2 settlement/u,
  );
  assert.throws(
    () =>
      validateProductionPairBoundary({
        ...source,
        bindings: {
          ...source.bindings,
          database_roles: {
            ...source.bindings.database_roles,
            reconciler: source.bindings.database_roles.runtime,
          },
        },
      }),
    /roles must remain distinct/u,
  );
  assert.throws(
    () =>
      validateProductionPairBoundary({
        ...source,
        wrangler: source.wrangler.replace(
          '"VIDEOFORGE_GPU_TRANSPORT": "DISABLED_UNQUALIFIED",',
          '"VIDEOFORGE_GPU_TRANSPORT": "QUALIFIED_EXACT",\n    "VIDEOFORGE_DISPATCH_TOKEN_KEY": "plaintext",',
        ),
      }),
    /must never be a plaintext Wrangler var/u,
  );
});
