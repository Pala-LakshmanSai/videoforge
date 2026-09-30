// @vitest-environment node
import {beforeEach,it,expect,vi} from "vitest";
const f=vi.hoisted(()=>({config:{publicOrigin:"https://app.test",neon:{databaseUrl:"fixture"},apiGeneration:{},cloudMedia:{spanBatchProtocol:2}},
  query:vi.fn(),prepare:vi.fn(),prompts:vi.fn(),admitted:true}));
vi.mock("./configuration",()=>({hostedRuntimeConfiguration:()=>f.config,configuredHostedRuntimeConfiguration:async()=>f.config}));
vi.mock("./neon",()=>({createNeonPool:()=>({query:f.query,end:async()=>{}}),
 createNeonExecutor:()=>({transaction:async(work:(db:unknown)=>unknown)=>work({query:f.query})})}));
vi.mock("./app",()=>({hostedGpuActivationDatabaseSource:()=>undefined,
 createHostedV209SpanAudioLiveCoordinator:async()=>({prepare:f.prepare})}));
vi.mock("./hosted-prompt-route",()=>({writeProjectPrompts:f.prompts}));
vi.mock("./hosted-prompt-next-stage",()=>({dispatchAcceptedHostedPrompts:vi.fn()}));
import {DUE_QUERY,runHostedContinuation} from "./stage-continuation-sweep";
const row={account_id:"11111111-1111-4111-8111-111111111111",workspace_id:"22222222-2222-4222-8222-222222222222",
 user_id:"33333333-3333-4333-8333-333333333333",project_id:"44444444-4444-4444-8444-444444444444",
 revision_id:"55555555-5555-4555-8555-555555555555",next_step:"prompts",asr_attempt_id:null};
beforeEach(()=>{
 f.config.cloudMedia.spanBatchProtocol=2;f.admitted=true;vi.clearAllMocks();
 f.query.mockImplementation(async(sql:string)=>sql===DUE_QUERY?{rows:[row]}:sql.includes("AS ready")?{rows:[{ready:f.admitted}]}:{rows:[]});
 f.prepare.mockResolvedValue({state:"PREPARING_INPUTS"});f.prompts.mockResolvedValue(Response.json({state:"SCHEDULED"}));
});
it("starts at most eight admitted Cloud clips while prompts are still pending",async()=>{
 let releasePrompt!:()=>void,started!:()=>void;
 const pendingPrompt=new Promise<void>(resolve=>{releasePrompt=resolve;});
 const clipStarted=new Promise<void>(resolve=>{started=resolve;});
 f.prompts.mockImplementation(async()=>{await pendingPrompt;return Response.json({state:"SCHEDULED"});});
 f.prepare.mockImplementation(async()=>{started();return {state:"PREPARING_INPUTS"};});
 const sidecars:Promise<unknown>[]=[];
 const run=runHostedContinuation({} as never,{waitUntil:p=>sidecars.push(p)},
  {accountId:row.account_id,projectId:row.project_id,revisionId:row.revision_id,step:"prompts"});
 await clipStarted;
 expect(f.prepare).toHaveBeenCalledWith({accountId:row.account_id,workspaceId:row.workspace_id,userId:row.user_id,projectId:row.project_id},true,8);
 releasePrompt();expect(await run).toEqual([row.project_id+":prompts"]);await Promise.all(sidecars);
 expect(f.query.mock.calls.some(([sql])=>String(sql).includes("r.media_execution_backend='RUNPOD_POD'"))).toBe(true);
});
it.each(["legacy","unadmitted"])("keeps %s work out of early Cloud preparation",async mode=>{
 if(mode==="legacy")f.config.cloudMedia.spanBatchProtocol=1;else f.admitted=false;
 const pending:Promise<unknown>[]=[];
 await runHostedContinuation({} as never,{waitUntil:p=>pending.push(p)},
  {accountId:row.account_id,projectId:row.project_id,revisionId:row.revision_id,step:"prompts"});
 await Promise.all(pending);expect(f.prepare).not.toHaveBeenCalled();expect(f.prompts).toHaveBeenCalledOnce();
});
