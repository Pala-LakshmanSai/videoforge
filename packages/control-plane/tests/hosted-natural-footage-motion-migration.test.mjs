import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createFixtureDatabase, applyMigrationSliceThrough } from "./support/pglite.mjs";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";

const source = readFileSync(
  new URL("../migrations/0273_hosted_natural_footage_motion.sql", import.meta.url),
  "utf8",
);
test("0273 pins future motion, preserves legacy and rollback, and spreads deterministic camera requests", async () => {
  const { database: db, executor, sources } = await createFixtureDatabase();
  try {
    await applyMigrationSliceThrough(executor, 272, sources);
    await seedLockedProjects(executor);
    const a = IDS.accountA,
      w = IDS.workspaceA,
      p = "00000000-0000-4000-8000-000000273001";
    await db.query("SELECT set_config('videoforge.account_id',$1,false)", [a]);
    await db.query(
      "INSERT INTO projects(id,workspace_id,owner_user_id,name,normalized_name,generation_provider) VALUES($1,$2,$3,'Motion proof','motion proof','KIE_FAL')",
      [p, w, IDS.userA],
    );
    const revision = async (n) => {
      const r = `00000000-0000-4000-8000-00000027300${n}`;
      await db.query(
        "INSERT INTO project_revisions SELECT (jsonb_populate_record(NULL::project_revisions,to_jsonb(rev)||$1::jsonb)).* FROM project_revisions rev WHERE rev.id=$2",
        [
          JSON.stringify({
            id: r,
            project_id: p,
            revision_number: n,
            revision_config_payload: {
              scheduler_version: "scheduler-v12",
              avatar_enabled: true,
              ai_video_opening_seconds: 180,
            },
          }),
          IDS.revisionA,
        ],
      );
      return r;
    };
    const pin = async (r) =>
      (
        await db.query(
          "SELECT videoforge_pin_hosted_video_plan($1,$2,$3,7,'FOOTAGE_COMPOSITION_V5',180) value",
          [a, w, r],
        )
      ).rows[0].value;
    const old = await revision(2),
      before = await pin(old);
    const signatures = [
      "videoforge_pin_hosted_video_plan(uuid,uuid,uuid,integer,text,integer)",
      "videoforge_claim_hosted_video_job(uuid,uuid,uuid,uuid,uuid)",
    ];
    const definitions = async () =>
      (
        await db.query(
          "SELECT jsonb_object_agg(s,pg_get_functiondef(s::regprocedure)) value FROM unnest($1::text[]) s",
          [signatures],
        )
      ).rows[0].value;
    const original = await definitions();
    await db.exec("BEGIN");
    await executor.execute(source);
    await db.exec("ROLLBACK");
    assert.deepEqual(await definitions(), original);
    assert.deepEqual(await pin(old), before);
    await executor.execute(source);
    const retained = await pin(old);
    assert.equal(retained.motion_policy, "FIXED_CAMERA_V1");
    delete retained.motion_policy;
    assert.deepEqual(retained, before);
    const fresh = await revision(3),
      planned = await pin(fresh);
    assert.equal(planned.motion_policy, "NATURAL_HANDHELD_V1");
    assert.deepEqual(await pin(fresh), planned);
    await assert.rejects(
      db.query(
        "UPDATE hosted_video_plans SET motion_policy='FIXED_CAMERA_V1' WHERE project_revision_id=$1",
        [fresh],
      ),
      /immutable/,
    );
    const moves = (
      await db.query(
        "SELECT slot,videoforge_natural_footage_motion(slot) value FROM generate_series(0,99) slot",
      )
    ).rows;
    const totals = { PAN: 0, PAN_IN: 0, PAN_OUT: 0 };
    let modest = 0;
    for (const { slot, value } of moves) {
      totals[value.cameraMotion]++;
      assert.equal(value.cameraFixed, false);
      assert.equal(value.motionPolicy, "NATURAL_HANDHELD_V1");
      assert(value.prompt.length < 3000);
      assert(value.prompt.includes("available environmental light"));
      assert(value.prompt.includes("slightly soft natural detail"));
      assert(value.prompt.includes("No cuts, text"));
      assert(value.prompt.includes(slot % 2 === 0 ? "to the right" : "to the left"));
      if (value.prompt.includes("modest, unhurried")) modest++;
    }
    assert.deepEqual(totals, { PAN: 70, PAN_IN: 20, PAN_OUT: 10 });
    assert.equal(modest, 15);
    for (const slot of [null, -1])
      await assert.rejects(
        db.query("SELECT videoforge_natural_footage_motion($1)", [slot]),
        /invalid/,
      );
    const updated = await definitions();
    const claim = updated[signatures[1]];
    assert(
      claim.indexOf("IF j.state<>'PREPARED'") < claim.indexOf("videoforge_natural_footage_motion"),
    );
    assert(
      claim.indexOf("videoforge_natural_footage_motion") < claim.indexOf("input_sha256='sha256:'"),
    );
    assert(
      claim.includes("source.state='SUCCEEDED'") ||
        claim.includes("lane='IMAGE' AND state='SUCCEEDED'"),
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('videoforge_v209_runtime_dc9612d6','videoforge_natural_footage_motion(integer)','EXECUTE') value",
        )
      ).rows[0].value,
      false,
    );
    await assert.rejects(executor.execute(source), /already exists/);
  } finally {
    await db.close();
  }
});
