/**
 * lib/research/drive/server.ts — server-only Google Drive helpers.
 * Agent B calls deleteDriveFiles() from consent withdrawal (signature fixed in Wave 0).
 */

import "server-only";
import { getServiceClient } from "../supabase/server";
import { deleteFilesWith } from "./deleteFiles";
import { oauthClientFromEnv } from "./google";

/**
 * Deletes app-created files from the organization's connected Drive (drive.file scope).
 * Missing files count as deleted. Never throws for individual file failures; returns them.
 * If Drive is not connected or needs reconnecting, every file is returned as failed.
 */
export async function deleteDriveFiles(orgId: string, fileIds: string[]): Promise<{ deleted: number; failed: string[] }> {
  if (fileIds.length === 0) return { deleted: 0, failed: [] };
  let client;
  try {
    client = oauthClientFromEnv();
  } catch {
    return { deleted: 0, failed: [...fileIds] };
  }
  return deleteFilesWith(getServiceClient(), fetch, client, orgId, fileIds);
}
