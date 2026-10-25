/**
 * lib/research/drive/deleteFiles.ts — testable core of deleteDriveFiles() (see server.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteFile, findFolder, type Fetch, type OAuthClient } from "./google";
import { getAccessToken } from "./service";

export async function deleteFilesWith(
  svc: SupabaseClient,
  f: Fetch,
  client: OAuthClient,
  orgId: string,
  fileIds: string[],
): Promise<{ deleted: number; failed: string[] }> {
  const ids = [...new Set(fileIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return { deleted: 0, failed: [] };
  let token: string;
  try {
    token = await getAccessToken(svc, f, client, orgId);
  } catch {
    return { deleted: 0, failed: ids };
  }
  let deleted = 0;
  const failed: string[] = [];
  for (const id of ids) {
    try {
      if (await deleteFile(f, token, id)) deleted++;
      else failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { deleted, failed };
}

/**
 * Deletes the child's folder ("<root>/<child code>") if it exists. Never creates anything; never throws.
 * True when the folder is gone (deleted or never existed), false when Drive is unreachable or not connected.
 */
export async function deleteChildFolderWith(
  svc: SupabaseClient,
  f: Fetch,
  client: OAuthClient,
  orgId: string,
  childCode: string,
): Promise<boolean> {
  try {
    const { data: org } = await svc.from("organizations").select("drive_folder_id").eq("id", orgId).maybeSingle();
    const rootId = (org?.drive_folder_id as string | null | undefined) ?? null;
    if (!rootId) return true; // nothing was ever uploaded for this organization
    const token = await getAccessToken(svc, f, client, orgId);
    const folderId = await findFolder(f, token, childCode, rootId);
    if (!folderId) return true;
    return await deleteFile(f, token, folderId);
  } catch {
    return false;
  }
}
