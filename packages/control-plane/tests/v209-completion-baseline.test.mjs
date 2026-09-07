import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { IDS, seedAttempt } from "./support/fixtures.mjs";
import { expectDatabaseError, uuid, withPgcryptoMigratedDatabase } from "./support/pglite.mjs";

const readBaseline = (executor, accountId = IDS.accountA, maximum = 15_500_000) =>
  executor.transaction(async (tx) => {
    await tx.query("SELECT set_config('videoforge.account_id',$1,true)", [accountId]);
    return (
      await tx.query("SELECT videoforge_read_hosted_v209_completion_baseline($1,$2,$3) value", [
        IDS.accountA,
        IDS.workspaceA,
        maximum,
      ])
    ).rows[0].value;
  });

test("0085 derives one conservative integer-micro-USD exposure per generic project attempt", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    await seedAttempt(executor);
    const rows = [
      [uuid(850001), 1, "RESERVED", 1_000_000],
      [uuid(850002), 2, "REPORTED", 400_000],
      [uuid(850003), 3, "SETTLED", 400_000],
      [uuid(850004), 4, "RELEASED", 300_000],
    ];
    for (const [id, sequence, eventType, amount] of rows)
      await executor.query(
        `INSERT INTO cost_events(id,account_id,workspace_id,owner_type,owner_id,task_id,
          attempt_id,sequence,event_type,amount_micro_usd,idempotency_key,occurred_at)
         VALUES($1,$2,$3,'PROJECT_REVISION',$4,$5,$6,$7,$8,$9,$10,transaction_timestamp())`,
        [
          id,
          IDS.accountA,
          IDS.workspaceA,
          IDS.revisionA,
          IDS.taskA,
          IDS.attemptA1,
          sequence,
          eventType,
          amount,
          `v209-baseline-${sequence}`,
        ],
      );
    const receipt = await readBaseline(executor);
    assert.equal(receipt.attemptCount, 1);
    assert.equal(receipt.settledNetMicroUsd, 400_000);
    assert.equal(receipt.openReservationMicroUsd, 300_000);
    assert.equal(receipt.reportedUnsettledMicroUsd, 0);
    assert.equal(receipt.completionBaselineMicroUsd, 700_000);
    assert.match(receipt.receiptSha256, /^sha256:[0-9a-f]{64}$/u);
  });
});

test("0085 is tenant-bound and enforces the approved 15.50 USD maximum", async () => {
  await withPgcryptoMigratedDatabase(async ({ executor }) => {
    await seedAttempt(executor);
    await expectDatabaseError(() => readBaseline(executor, IDS.accountB), "42501");
    await expectDatabaseError(() => readBaseline(executor, IDS.accountA, 15_500_001), "23514");
  });
});

test("0085 baseline capability is activation-operator and reconciler only", async () => {
  const [operator, reconciler] = await Promise.all([
    readFile("deploy/v2-09/neon-qualified-activation-operator-grants.sql", "utf8"),
    readFile("deploy/v2-09/neon-pair-reconciler-grants.sql", "utf8"),
  ]);
  const signature = "public.videoforge_read_hosted_v209_completion_baseline(uuid,uuid,bigint)";
  assert.ok(operator.includes(`GRANT EXECUTE ON FUNCTION ${signature}\nTO :"operator_role";`));
  assert.ok(operator.includes(`REVOKE EXECUTE ON FUNCTION ${signature}\nFROM :"runtime_role";`));
  assert.ok(reconciler.includes(`GRANT EXECUTE ON FUNCTION\n`));
  assert.ok(reconciler.includes(`${signature}\nTO :"reconciler_role";`));
  assert.ok(reconciler.includes(`${signature}\nFROM :"runtime_role";`));
});
