/**
 * lib/research/drive/server.ts — server-only Google Drive helpers.
 * Wave 0 STUB: agent A implements these, keeping the signatures. Agent B calls deleteDriveFiles().
 */

import "server-only";

/**
 * Deletes app-created files from the organization's connected Drive (drive.file scope).
 * Missing files count as deleted. Never throws for individual file failures; returns them.
 */
export async function deleteDriveFiles(orgId: string, fileIds: string[]): Promise<{ deleted: number; failed: string[] }> {
  void orgId;
  if (fileIds.length === 0) return { deleted: 0, failed: [] };
  // Stub until agent A's implementation lands: report all as failed so callers can surface it.
  return { deleted: 0, failed: [...fileIds] };
}
