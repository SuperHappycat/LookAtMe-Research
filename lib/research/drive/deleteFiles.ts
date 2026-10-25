/**
 * lib/research/drive/deleteFiles.ts — testable core of deleteDriveFiles() (see server.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteFile, type Fetch, type OAuthClient } from "./google";
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
