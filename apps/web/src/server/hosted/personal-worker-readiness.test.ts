// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import type { SqlExecutor } from "@videoforge/control-plane";
import { expect, it } from "vitest";
import type { HostedRuntimeConfiguration } from "./configuration";
import { qualifiedPersonalWorkers } from "./personal-worker-readiness";

const account="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", workspace="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const bundle=`sha256:${"a".repeat(64)}`;
const release={minimumProtocolVersion:3,executionBundleSha256:bundle} as HostedRuntimeConfiguration["mediaWorkerRelease"];

it.each([
  ["ONLINE", "10 seconds", 3, bundle, false, account, workspace, "ONLINE"],
  ["ONLINE", "91 seconds", 3, bundle, false, account, workspace, "WAITING_FOR_YOUR_COMPUTER"],
  ["ONLINE", "10 seconds", 2, bundle, false, account, workspace, "WAITING_FOR_YOUR_COMPUTER"],
  ["ONLINE", "10 seconds", 3, `sha256:${"b".repeat(64)}`, false, account, workspace, "WAITING_FOR_YOUR_COMPUTER"],
  ["ONLINE", "10 seconds", 3, bundle, true, account, workspace, "WAITING_FOR_YOUR_COMPUTER"],
  ["BUSY", "10 seconds", 3, bundle, false, account, workspace, "BUSY"],
  ["REVOKED", "10 seconds", 3, bundle, false, account, workspace, "WAITING_FOR_YOUR_COMPUTER"],
  ["ONLINE", "10 seconds", 3, bundle, false, workspace, workspace, "WAITING_FOR_YOUR_COMPUTER"],
  ["ONLINE", "10 seconds", 3, bundle, false, account, account, "WAITING_FOR_YOUR_COMPUTER"],
] as const)("uses fresh eligible tenant devices for readiness %#", async (status, age, protocol, hash, removed, owner, scope, expected) => {
  const database=new PGlite();
  try {
    await database.exec(`CREATE TABLE media_worker_devices (account_id uuid,workspace_id uuid,status text,
      last_seen_at timestamptz,protocol_version integer,execution_bundle_sha256 text,removed_at timestamptz)`);
    await database.query(`INSERT INTO media_worker_devices VALUES($1,$2,$3,now()-$4::interval,$5,$6,
      CASE WHEN $7::boolean THEN now() ELSE NULL END)`,[owner,scope,status,age,protocol,hash,removed]);
    const executor: SqlExecutor={execute:async sql => {await database.exec(sql);},
      query:async <Row extends Record<string,unknown>>(sql:string,parameters=[]) => {
        const result=await database.query<Row>(sql,[...parameters]);
        return {rows:result.rows,affectedRows:result.affectedRows ?? 0};
      }};
    expect(await qualifiedPersonalWorkers(executor,release,account,workspace)).toEqual({
      count:expected==="WAITING_FOR_YOUR_COMPUTER" ? 0 : 1,state:expected});
  } finally {await database.close();}
});
