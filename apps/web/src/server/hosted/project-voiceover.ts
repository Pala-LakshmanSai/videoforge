import type { SqlExecutor } from "@videoforge/control-plane";
import type { HostedScope } from "./hosted-product-route-common";

export interface ProjectVoiceover extends Record<string, unknown> {
  revision_id: string;
  object_key: string;
  content_length: number | string;
  checksum_sha256: string;
  content_type: "audio/mpeg" | "audio/wav";
  voiceover_filename: string | null;
}

/** Resolve the owner's current accepted narration, including a retained ASR recovery source. */
export async function readProjectVoiceover(
  transaction: SqlExecutor,
  scope: HostedScope,
  projectId: string,
): Promise<ProjectVoiceover | undefined> {
  const result = await transaction.query<ProjectVoiceover>(
    `SELECT revision.id::text AS revision_id, receipt.object_key,
            receipt.content_length, receipt.checksum_sha256, receipt.content_type,
            asset.metadata->>'filename' AS voiceover_filename
       FROM projects AS project
       JOIN project_revisions AS revision
         ON revision.account_id=project.account_id AND revision.workspace_id=project.workspace_id
        AND revision.project_id=project.id AND revision.status='LOCKED'
        AND revision.id=(SELECT current_revision.id FROM project_revisions current_revision
          WHERE current_revision.account_id=project.account_id
            AND current_revision.workspace_id=project.workspace_id
            AND current_revision.project_id=project.id AND current_revision.status='LOCKED'
          ORDER BY current_revision.revision_number DESC, current_revision.id DESC LIMIT 1)
       JOIN assets AS asset
         ON asset.account_id=revision.account_id AND asset.workspace_id=revision.workspace_id
        AND asset.project_id=revision.project_id AND asset.id=revision.voiceover_asset_id
        AND asset.kind='VOICEOVER' AND asset.state='VERIFIED'
        AND asset.binary_sha256=revision.voiceover_binary_sha256
       JOIN artifact_reservations AS reservation
         ON reservation.account_id=revision.account_id AND reservation.workspace_id=revision.workspace_id
        AND reservation.project_id=revision.project_id AND reservation.asset_id=asset.id
        AND reservation.state='COMMITTED' AND reservation.object_key=asset.object_key
       JOIN artifact_receipts AS receipt
         ON receipt.account_id=reservation.account_id AND receipt.workspace_id=reservation.workspace_id
        AND receipt.reservation_id=reservation.id AND receipt.deleted_at IS NULL
        AND receipt.object_key=reservation.object_key AND receipt.checksum_sha256=asset.binary_sha256
        AND receipt.content_length=asset.byte_size AND receipt.content_type=asset.content_type
        AND (reservation.project_revision_id=revision.id OR EXISTS(
          SELECT 1 FROM cloud_media_asr_recoveries recovery
           WHERE recovery.account_id=revision.account_id AND recovery.workspace_id=revision.workspace_id
             AND recovery.project_id=revision.project_id AND recovery.project_revision_id=revision.id
             AND recovery.source_receipt_id=receipt.id))
      WHERE project.account_id=$1 AND project.workspace_id=$2 AND project.id=$3
        AND project.status='ACTIVE' AND project.project_kind='USER'
        AND receipt.content_type IN ('audio/mpeg','audio/wav')
      ORDER BY receipt.committed_at DESC, receipt.id DESC LIMIT 1`,
    [scope.account_id, scope.workspace_id, projectId],
  );
  return result.rows[0];
}
