import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const migration = (filename) =>
  readFileSync(new URL(`packages/control-plane/migrations/${filename}`, root), "utf8");
const artifactReservationGuard0076 = (() => {
  const source = migration("0076_hosted_v209_system_avatar_reference.sql");
  const start = source.indexOf(
    "CREATE OR REPLACE FUNCTION public.videoforge_artifact_reservation_guard()",
  );
  const end = source.indexOf(
    "CREATE OR REPLACE FUNCTION public.videoforge_artifact_receipt_guard()",
    start,
  );
  if (start < 0 || end < 0) throw new Error("0076 reservation guard preimage missing");
  return source.slice(start, end);
})();

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

test(
  "real PostgreSQL permits only bounded pending browser-upload expiry renewal",
  { timeout: 60_000 },
  async (t) => {
    const image = spawnSync("docker", ["image", "inspect", "postgres:17-alpine"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (image.status !== 0) {
      t.skip("postgres:17-alpine is not available locally");
      return;
    }

    const container = `videoforge-upload-renewal-${randomUUID()}`;
    const run = (args, input = undefined) =>
      spawnSync("docker", args, {
        encoding: "utf8",
        input,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000,
      });
    const sql = (statement) =>
      run(
        [
          "exec",
          "-i",
          container,
          "psql",
          "-X",
          "-q",
          "-U",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
          "-At",
        ],
        statement,
      );
    const expectSuccess = (result) => {
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      return result.stdout.trim();
    };

    const accountId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const revisionId = randomUUID();
    const assetId = randomUUID();
    const reservationId = randomUUID();
    const requestId = randomUUID();
    const objectKey =
      `tenant/${accountId}/workspace/${workspaceId}/project/${projectId}` +
      `/revision/${revisionId}/lane/input/job/browser-upload/artifact/voiceover`;
    const checksum = `sha256:${"a".repeat(64)}`;

    try {
      const started = run([
        "run",
        "--pull=never",
        "--network",
        "none",
        "--rm",
        "-d",
        "--name",
        container,
        "--tmpfs",
        "/var/lib/postgresql/data",
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "postgres:17-alpine",
      ]);
      expectSuccess(started);

      let ready = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (run(["exec", container, "pg_isready", "-U", "postgres"]).status === 0) {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(ready, true, "PostgreSQL did not become ready");

      // These are the referenced tenant tables/functions needed to apply the
      // production reservation migration in isolation. The reservation table,
      // identity trigger, and unique object key are production SQL verbatim.
      expectSuccess(
        sql(`
          CREATE TABLE public.workspaces (
            account_id uuid NOT NULL,
            id uuid NOT NULL,
            PRIMARY KEY (account_id, id)
          );
          CREATE TABLE public.projects (
            account_id uuid NOT NULL,
            workspace_id uuid NOT NULL,
            id uuid NOT NULL,
            status text NOT NULL,
            PRIMARY KEY (account_id, workspace_id, id)
          );
          CREATE TABLE public.project_revisions (
            account_id uuid NOT NULL,
            workspace_id uuid NOT NULL,
            id uuid NOT NULL,
            PRIMARY KEY (account_id, workspace_id, id)
          );
          CREATE TABLE public.assets (
            account_id uuid NOT NULL,
            workspace_id uuid NOT NULL,
            id uuid NOT NULL,
            PRIMARY KEY (account_id, workspace_id, id)
          );
          CREATE FUNCTION public.videoforge_current_account_id() RETURNS uuid
          LANGUAGE sql STABLE AS $$ SELECT current_setting('videoforge.account_id', true)::uuid $$;
          CREATE FUNCTION public.videoforge_assert_tenant_write() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
          CREATE FUNCTION public.videoforge_is_hosted_v209_system_avatar_reference(
            uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text
          ) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
          ${migration("0019_tenant_artifact_receipts.sql")}
          ${artifactReservationGuard0076}
          DO $scope$
          DECLARE definition text; actual_source_sha256 text;
          BEGIN
            SELECT pg_get_functiondef(oid), encode(sha256(convert_to(prosrc, 'UTF8')), 'hex')
              INTO definition, actual_source_sha256
              FROM pg_proc
             WHERE oid = 'public.videoforge_artifact_reservation_guard()'::regprocedure;
            IF actual_source_sha256 IS DISTINCT FROM
              'dab1479dfdbd71edb20d099847319107b55d1a67611f23fb240d365bb064112c' THEN
              RAISE EXCEPTION '0076 reservation guard preimage drift';
            END IF;
            definition := overlay(definition placing
              'BEGIN
  IF public.videoforge_current_account_id() IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION ''hosted artifact trigger tenant scope denied'' USING ERRCODE=''42501'';
  END IF;'
              from position('BEGIN' IN definition) for length('BEGIN'));
            EXECUTE definition;
            EXECUTE 'ALTER FUNCTION public.videoforge_artifact_reservation_guard() SECURITY DEFINER';
            EXECUTE 'ALTER FUNCTION public.videoforge_artifact_reservation_guard() SET search_path=pg_catalog,public';
          END
          $scope$;
          CREATE TABLE public.hosted_project_create_requests (
            id uuid PRIMARY KEY,
            account_id uuid NOT NULL,
            workspace_id uuid NOT NULL,
            project_id uuid NOT NULL,
            project_revision_id uuid NOT NULL,
            voiceover_asset_id uuid NOT NULL,
            upload_reservation_id uuid NOT NULL,
            state text NOT NULL
          );
          ${migration("0133_hosted_pending_upload_renewal.sql")}
        `),
      );

      expectSuccess(
        sql(`
          SELECT set_config('videoforge.account_id', ${sqlLiteral(accountId)}, false);
          INSERT INTO public.workspaces(account_id, id)
          VALUES (${sqlLiteral(accountId)}, ${sqlLiteral(workspaceId)});
          INSERT INTO public.projects(account_id, workspace_id, id, status)
          VALUES (${sqlLiteral(accountId)}, ${sqlLiteral(workspaceId)}, ${sqlLiteral(projectId)}, 'ACTIVE');
          INSERT INTO public.project_revisions(account_id, workspace_id, id)
          VALUES (${sqlLiteral(accountId)}, ${sqlLiteral(workspaceId)}, ${sqlLiteral(revisionId)});
          INSERT INTO public.assets(account_id, workspace_id, id)
          VALUES (${sqlLiteral(accountId)}, ${sqlLiteral(workspaceId)}, ${sqlLiteral(assetId)});
          INSERT INTO public.artifact_reservations(
            id, account_id, workspace_id, project_id, project_revision_id, asset_id,
            lane, job_id, artifact_id, object_key, method, content_type,
            content_length, checksum_sha256, expires_at, max_uses, retention_class,
            deletion_owner_account_id
          ) VALUES (
            ${sqlLiteral(reservationId)}, ${sqlLiteral(accountId)}, ${sqlLiteral(workspaceId)},
            ${sqlLiteral(projectId)}, ${sqlLiteral(revisionId)}, ${sqlLiteral(assetId)},
            'INPUT', 'browser-upload', 'voiceover', ${sqlLiteral(objectKey)}, 'PUT',
            'audio/mpeg', 10, ${sqlLiteral(checksum)}, now() + interval '2 minutes', 1,
            'PROJECT', ${sqlLiteral(accountId)}
          );
          INSERT INTO public.hosted_project_create_requests(
            id, account_id, workspace_id, project_id, project_revision_id,
            voiceover_asset_id, upload_reservation_id, state
          ) VALUES (
            ${sqlLiteral(requestId)}, ${sqlLiteral(accountId)}, ${sqlLiteral(workspaceId)},
            ${sqlLiteral(projectId)}, ${sqlLiteral(revisionId)}, ${sqlLiteral(assetId)},
            ${sqlLiteral(reservationId)}, 'UPLOAD_PENDING'
          );
        `),
      );

      const renewed = expectSuccess(
        sql(`
          UPDATE public.artifact_reservations
             SET expires_at = now() + interval '15 minutes'
           WHERE id = ${sqlLiteral(reservationId)}
             AND account_id = ${sqlLiteral(accountId)}
             AND workspace_id = ${sqlLiteral(workspaceId)}
             AND state = 'ISSUED'
             AND used_count = 0
           RETURNING expires_at;
          SELECT count(*) FROM public.artifact_reservations
           WHERE account_id = ${sqlLiteral(accountId)}
             AND workspace_id = ${sqlLiteral(workspaceId)}
             AND object_key = ${sqlLiteral(objectKey)}
             AND method = 'PUT';
        `),
      );
      assert.equal(renewed.split("\n").at(-1), "1");

      const tooLong = sql(`
        SELECT set_config('videoforge.account_id', ${sqlLiteral(accountId)}, false);
        UPDATE public.artifact_reservations
           SET expires_at = now() + interval '16 minutes'
         WHERE id = ${sqlLiteral(reservationId)};
      `);
      assert.notEqual(tooLong.status, 0);
      assert.match(tooLong.stderr, /expiry renewal rejected|55000/u);

      const wrongTenant = sql(`
        SELECT set_config('videoforge.account_id', ${sqlLiteral(randomUUID())}, false);
        UPDATE public.artifact_reservations
           SET expires_at = now() + interval '15 minutes'
         WHERE id = ${sqlLiteral(reservationId)};
      `);
      assert.notEqual(wrongTenant.status, 0);
      assert.match(wrongTenant.stderr, /tenant scope denied|42501/u);

      const contentMutation = sql(`
        SELECT set_config('videoforge.account_id', ${sqlLiteral(accountId)}, false);
        UPDATE public.artifact_reservations SET content_length = 11
         WHERE id = ${sqlLiteral(reservationId)};
      `);
      assert.notEqual(contentMutation.status, 0);
      assert.match(contentMutation.stderr, /identity and scope are immutable|55000/u);

      const readyRequest = sql(`
        SELECT set_config('videoforge.account_id', ${sqlLiteral(accountId)}, false);
        BEGIN;
        UPDATE public.hosted_project_create_requests SET state = 'READY'
         WHERE id = ${sqlLiteral(requestId)};
        UPDATE public.artifact_reservations
           SET expires_at = now() + interval '15 minutes'
         WHERE id = ${sqlLiteral(reservationId)};
        COMMIT;
      `);
      assert.notEqual(readyRequest.status, 0);
      assert.match(readyRequest.stderr, /expiry renewal rejected|55000/u);

      const usedReservation = sql(`
        SELECT set_config('videoforge.account_id', ${sqlLiteral(accountId)}, false);
        BEGIN;
        UPDATE public.artifact_reservations SET used_count = 1
         WHERE id = ${sqlLiteral(reservationId)};
        UPDATE public.artifact_reservations
           SET expires_at = now() + interval '15 minutes'
         WHERE id = ${sqlLiteral(reservationId)};
        COMMIT;
      `);
      assert.notEqual(usedReservation.status, 0);
      assert.match(usedReservation.stderr, /expiry renewal rejected|55000/u);

      const receipt = sql(`
        SELECT set_config('videoforge.account_id', ${sqlLiteral(accountId)}, false);
        BEGIN;
        INSERT INTO public.artifact_receipts(
          id, account_id, workspace_id, reservation_id, callback_id, object_key,
          content_type, content_length, checksum_sha256, receipt_sha256, committed_at
        ) VALUES (
          ${sqlLiteral(randomUUID())}, ${sqlLiteral(accountId)}, ${sqlLiteral(workspaceId)},
          ${sqlLiteral(reservationId)}, 'pending-renewal-receipt', ${sqlLiteral(objectKey)},
          'audio/mpeg', 10, ${sqlLiteral(checksum)}, ${sqlLiteral(`sha256:${"b".repeat(64)}`)}, now()
        );
        UPDATE public.artifact_reservations
           SET expires_at = now() + interval '15 minutes'
         WHERE id = ${sqlLiteral(reservationId)};
        COMMIT;
      `);
      assert.notEqual(receipt.status, 0);
      assert.match(receipt.stderr, /expiry renewal rejected|55000|receipt/u);

      const duplicate = sql(`
        INSERT INTO public.artifact_reservations(
          id, account_id, workspace_id, project_id, project_revision_id, asset_id,
          lane, job_id, artifact_id, object_key, method, content_type,
          content_length, checksum_sha256, expires_at, max_uses, retention_class,
          deletion_owner_account_id
        ) VALUES (
          ${sqlLiteral(randomUUID())}, ${sqlLiteral(accountId)}, ${sqlLiteral(workspaceId)},
          ${sqlLiteral(projectId)}, ${sqlLiteral(revisionId)}, ${sqlLiteral(assetId)},
          'INPUT', 'browser-upload', 'voiceover', ${sqlLiteral(objectKey)}, 'PUT',
          'audio/mpeg', 10, ${sqlLiteral(checksum)}, now() + interval '2 minutes', 1,
          'PROJECT', ${sqlLiteral(accountId)}
        );
      `);
      assert.notEqual(duplicate.status, 0);
      assert.match(duplicate.stderr, /duplicate key|unique/u);
    } finally {
      run(["rm", "-f", container]);
    }
  },
);
