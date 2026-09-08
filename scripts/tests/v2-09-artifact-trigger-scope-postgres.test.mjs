import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
test(
  "actual runtime create reproduces private trigger helper denial then scoped0088 closes the call chain",
  { timeout: 60000 },
  async () => {
    const name = "v209-create-" + randomUUID(),
      root = fileURLToPath(new URL("../../", import.meta.url));
    const run = (args, input) =>
      spawnSync("docker", args, { input, encoding: "utf8", timeout: 30000, maxBuffer: 4e6 });
    const sql = (s) =>
      run(
        ["exec", "-i", name, "psql", "-U", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
        s,
      );
    const ok = (r) => {
      if (r.status !== 0) throw Error(r.stderr);
      return r.stdout;
    };
    try {
      ok(
        run([
          "run",
          "--pull=never",
          "--network",
          "none",
          "--rm",
          "-d",
          "--name",
          name,
          "--tmpfs",
          "/var/lib/postgresql/data",
          "-e",
          "POSTGRES_HOST_AUTH_METHOD=trust",
          "postgres:17-alpine",
        ]),
      );
      for (let i = 0; i < 50; i++) {
        if (run(["exec", name, "pg_isready", "-U", "postgres"]).status === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 1000));
      ok(
        sql(
          "CREATE TABLE public.videoforge_schema_migrations(version integer primary key,name text,filename text,sha256 text,applied_at timestamptz default now());",
        ),
      );
      const manifest = JSON.parse(
        readFileSync(root + "/packages/control-plane/migrations/manifest.json"),
      );
      for (const m of manifest.migrations.filter((m) => m.version <= 87)) {
        const r = sql(
          readFileSync(root + "/packages/control-plane/migrations/" + m.filename, "utf8") +
            `\nINSERT INTO videoforge_schema_migrations(version,name,filename,sha256)VALUES(${m.version},'${m.name}','${m.filename}','${m.sha256}');`,
        );
        if (r.status !== 0) throw Error("migration " + m.version + " " + r.stderr);
      }
      const { seedReadyPresets, IDS, HASHES } = await import(
        root + "/packages/control-plane/tests/support/fixtures.mjs"
      );
      const literal = (v) =>
        v === null
          ? "NULL"
          : typeof v === "number"
            ? String(v)
            : typeof v === "boolean"
              ? String(v)
              : "'" + String(v).replaceAll("'", "''") + "'";
      const bind = (q, ps) => q.replace(/\$(\d+)/g, (_, n) => literal(ps[Number(n) - 1]));
      await seedReadyPresets({
        query: async (q, ps = []) => {
          if (q.includes("to_regclass")) return { rows: [{ present: true }] };
          ok(sql(bind(q, ps)));
          return { rows: [] };
        },
      });
      ok(
        sql(
          "CREATE ROLE vf_runtime LOGIN NOINHERIT;\n\\set runtime_role vf_runtime\n" +
            readFileSync(root + "/deploy/v2-09/neon-v209-runtime-grants.sql", "utf8"),
        ),
      );
      const source = readFileSync(root + "/apps/web/src/server/hosted/product.ts", "utf8");
      const slice = source.slice(
        source.indexOf("async function createProject("),
        source.indexOf("async function commitProject("),
      );
      const queries = [...slice.matchAll(/transaction\.query(?:<[^>]+>>)?\(\s*`([\s\S]*?)`/g)].map(
        (x) => x[1],
      );
      for (let i = 0; i < queries.length; i++) {
        const r = sql(
          `PREPARE q AS ${queries[i]}; SELECT parameter_types FROM pg_prepared_statements WHERE name='q';`,
        );
        if (r.status !== 0) throw Error(r.stderr);
      }
      const P = randomUUID(),
        R = randomUUID(),
        A = randomUUID(),
        reservation = randomUUID(),
        receipt = randomUUID(),
        audio = "sha256:" + "a".repeat(64),
        key = `tenant/${IDS.accountA}/workspace/${IDS.workspaceA}/project/${P}/revision/${R}/lane/input/job/browser-upload/artifact/voiceover`;
      const steps = [
        [1, [P, IDS.workspaceA, IDS.userA, "V2-09 production acceptance 2026-09-08"]],
        [
          2,
          [
            A,
            IDS.workspaceA,
            P,
            key,
            audio,
            "audio/wav",
            3279790,
            37154,
            '{"filename":"voice.wav"}',
          ],
        ],
        [
          3,
          [
            R,
            IDS.workspaceA,
            P,
            "V2-09 production acceptance 2026-09-08",
            A,
            audio,
            IDS.avatarProfileA,
            IDS.avatarVersionA,
            HASHES.avatarProfileA,
            IDS.avatarRuntimeA,
            HASHES.avatarRuntimeA,
            "owned-preparation-v1",
            "owned-validation-v1",
            IDS.styleA,
            IDS.styleVersionA,
            HASHES.styleA,
            null,
            false,
            "LOWEST_COST",
            null,
            42,
            "{}",
            "sha256:" + "b".repeat(64),
            IDS.userA,
          ],
        ],
        [4, [R, A]],
        [6, [reservation, IDS.accountA, IDS.workspaceA, P, R, A, key, "audio/wav", 3279790, audio]],
        [
          7,
          [
            randomUUID(),
            IDS.accountA,
            IDS.workspaceA,
            "native-create-fixture-0001",
            "sha256:" + "c".repeat(64),
            P,
            R,
            A,
            reservation,
            receipt,
          ],
        ],
      ];
      const result = sql(
        "\\set VERBOSITY verbose\nBEGIN; SET ROLE vf_runtime; SELECT set_config('videoforge.account_id'," +
          literal(IDS.accountA) +
          ",true);\n" +
          steps.map(([i, ps]) => bind(queries[i], ps) + ";").join("\n") +
          "\nCOMMIT;",
      );
      if (
        result.status === 0 ||
        !result.stderr.includes(
          "permission denied for function videoforge_is_hosted_v209_system_avatar_reference",
        )
      )
        throw Error("original defect not reproduced");
      ok(
        sql(
          readFileSync(
            root +
              "/packages/control-plane/migrations/0088_hosted_artifact_trigger_execution_scope.sql",
            "utf8",
          ),
        ),
      );
      const repaired = sql(
        "\\set VERBOSITY verbose\nBEGIN; SET ROLE vf_runtime; SELECT set_config('videoforge.account_id'," +
          literal(IDS.accountA) +
          ",true);\n" +
          steps.map(([i, ps]) => bind(queries[i], ps) + ";").join("\n") +
          "\nCOMMIT;",
      );
      if (repaired.status !== 0) throw Error(repaired.stderr);
      const receiptSql = `INSERT INTO artifact_receipts(id,account_id,workspace_id,reservation_id,
        callback_id,object_key,content_type,content_length,checksum_sha256,receipt_sha256,committed_at)
        VALUES(${literal(receipt)},${literal(IDS.accountA)},${literal(IDS.workspaceA)},${literal(reservation)},
        'native-upload-receipt',${literal(key)},'audio/wav',3279790,${literal(audio)},${literal("sha256:" + "d".repeat(64))},now());`;
      ok(
        sql(
          "BEGIN; SET ROLE vf_runtime; SELECT set_config('videoforge.account_id'," +
            literal(IDS.accountA) +
            ",true);" +
            receiptSql +
            "COMMIT;",
        ),
      );
      const missingScope = sql(
        "SET ROLE vf_runtime;" +
          bind(queries[6], [
            randomUUID(),
            IDS.accountA,
            IDS.workspaceA,
            P,
            R,
            A,
            key,
            "audio/wav",
            3279790,
            audio,
          ]),
      );
      if (missingScope.status === 0 || !missingScope.stderr.includes("tenant scope denied"))
        throw Error("missing scope accepted");
      const uuidHelper = sql(
        "SET ROLE vf_runtime; SELECT public.videoforge_hosted_v209_uuid('input-reservation'," +
          literal(randomUUID()) +
          "::uuid,'avatar-source');",
      );
      if (uuidHelper.status === 0 || !uuidHelper.stderr.includes("permission denied"))
        throw Error("UUID helper exposed");
      const helper = sql(
        "SET ROLE vf_runtime; SELECT public.videoforge_is_hosted_v209_system_avatar_reference(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);",
      );
      if (helper.status === 0 || !helper.stderr.includes("permission denied"))
        throw Error("helper exposed");
      const wrong = sql(
        "BEGIN; SET ROLE vf_runtime; SELECT set_config('videoforge.account_id'," +
          literal(IDS.accountB) +
          ",true);" +
          bind(queries[6], [
            randomUUID(),
            IDS.accountA,
            IDS.workspaceA,
            P,
            R,
            A,
            key,
            "audio/wav",
            3279790,
            audio,
          ]) +
          ";ROLLBACK;",
      );
      if (wrong.status === 0 || !wrong.stderr.includes("tenant scope denied"))
        throw Error("foreign scope accepted");
    } finally {
      run(["rm", "-f", name]);
    }
  },
);
