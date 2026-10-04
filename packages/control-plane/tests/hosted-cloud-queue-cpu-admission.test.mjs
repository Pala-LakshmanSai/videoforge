import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("waiting Cloud stages cannot block render continuation; Local CPU limits remain", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE global_generation_capacity(singleton boolean); INSERT INTO global_generation_capacity VALUES(true);
      CREATE TABLE hosted_cpu_job_attempts(id text,account_id text,workspace_id text,project_id text,state text,execution_backend text);`);
    await db.exec(
      await readFile(
        new URL("../migrations/0255_hosted_cloud_queue_cpu_admission.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(
      `CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON hosted_cpu_job_attempts FOR EACH ROW EXECUTE FUNCTION videoforge_guard_hosted_cpu_project_admission();`,
    );
    const add = (id, account, project, backend, state = "OUTBOXED") =>
      db.query("INSERT INTO hosted_cpu_job_attempts VALUES($1,$2,'workspace',$3,$4,$5)", [
        id,
        account,
        project,
        state,
        backend,
      ]);
    await add("queued-asr", "a", "next", "RUNPOD_POD");
    await add("current-render", "a", "current", "RUNPOD_POD", "PLANNED");
    await add("local-a", "a", "local", "PERSONAL_WORKER");
    await add("local-a-span", "a", "local", "PERSONAL_WORKER");
    await assert.rejects(add("local-a-other", "a", "other", "PERSONAL_WORKER"), /account already/);
    await add("local-b", "b", "local-b", "PERSONAL_WORKER");
    await assert.rejects(add("local-c", "c", "local-c", "PERSONAL_WORKER"), /both global/);
    await db.query(
      "UPDATE hosted_cpu_job_attempts SET state='SUCCEEDED' WHERE execution_backend='PERSONAL_WORKER'",
    );
    await add("running-cloud", "c", "running", "RUNPOD_POD", "RUNNING");
    await assert.rejects(
      add("local-c-conflict", "c", "other", "PERSONAL_WORKER"),
      /account already/,
    );
  } finally {
    await db.close();
  }
});
