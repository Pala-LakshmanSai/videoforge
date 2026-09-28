import { expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration } from "./configuration";

const state=vi.hoisted(() => ({rows:[] as Record<string,unknown>[],queries:[] as string[]}));
vi.mock("./auth",() => ({createHostedAuth:() => ({api:{getSession:async () => ({
  user:{id:"fixture-user"},session:{token:"fixture-session"}})}})}));
vi.mock("./neon",() => ({createNeonPool:() => ({query:async () => ({rows:[{
  account_id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",workspace_id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}]}),end:async () => {}}),
  createNeonExecutor:() => ({transaction:async (work:(sql:unknown)=>unknown) => work({query:async (sql:string) => {
    state.queries.push(sql);
    return {rows:sql.includes("FROM projects AS project") ? state.rows : [],affectedRows:0};
  }})})}));
import { handleHostedQueue } from "./hosted-queue";

const config={neon:{databaseUrl:"postgresql://fixture"},cloudMedia:{enabled:true},mediaWorkerRelease:{
  minimumProtocolVersion:3,executionBundleSha256:`sha256:${"a".repeat(64)}`}} as HostedRuntimeConfiguration;

it.each(["SUCCEEDED","FAILED","CANCELLED"])("does not offer cancellation/deletion while terminal %s Cloud cleanup is pending",async terminal => {
  state.rows=[{project_id:"11111111-1111-4111-8111-111111111111",title:"Private cloud",state:"IN_PROGRESS",
    stage:"Final assembly",execution_backend:"RUNPOD_POD",cloud_phase:"STOPPING",latest_state:terminal,
    active_cpu_count:0,active_request_count:1,total_serverless_count:0,nonplanned_serverless_count:0,
    active_serverless_count:0,dispatching_side_effect_count:0,cloud_reservation_count:1,
    created_at:"2026-09-28T00:00:00Z",updated_at:"2026-09-28T00:01:00Z"}];
  const result=await handleHostedQueue(new Request("https://fixture.example/api/v2/hosted/queue"),config,{waitUntil:()=>{}});
  const payload=await result.json() as {worker_state:string;projects:Record<string,unknown>[]};
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(payload.worker_state).toBe("WAITING_FOR_YOUR_COMPUTER");
  expect(payload.projects[0]).toMatchObject({execution_backend:"RUNPOD_POD",cloud_phase:"STOPPING",
    can_cancel_project:false,can_delete_project:false});
});
