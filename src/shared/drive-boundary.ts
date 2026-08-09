import type { ArtemisAuthContext } from "./artemis-auth.js";
import { GoogleApi, withQuery } from "./google-api.js";

const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  trashed?: boolean;
  driveId?: string;
  size?: string;
  webViewLink?: string;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
}

export class DriveBoundary {
  readonly roots: Set<string>;

  constructor(
    private readonly api: GoogleApi,
    auth: ArtemisAuthContext,
  ) {
    this.roots = new Set(auth.config.driveRootIds ?? []);
    if (this.roots.size === 0) {
      throw new Error(
        "No Drive root folders are enabled in Artemis for this plugin.",
      );
    }
  }

  async assertAllowed(fileId: string): Promise<DriveFile> {
    const file = await this.getFile(fileId);
    await this.assertParentChain(file);
    const targetId = file.shortcutDetails?.targetId;
    if (targetId) await this.assertParentChain(await this.getFile(targetId));
    return file;
  }

  async assertAllowedFolder(folderId: string): Promise<DriveFile> {
    const folder = await this.assertAllowed(folderId);
    if (folder.mimeType !== FOLDER_MIME)
      throw new Error(`Drive item ${folderId} is not a folder.`);
    return folder;
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const url = withQuery(`${DRIVE_FILES}/${encodeURIComponent(fileId)}`, {
      fields:
        "id,name,mimeType,parents,trashed,driveId,size,webViewLink,shortcutDetails(targetId,targetMimeType)",
      supportsAllDrives: true,
    });
    return await this.api.json<DriveFile>(url, {}, { readOnly: true });
  }

  private async assertParentChain(start: DriveFile): Promise<void> {
    if (this.roots.has(start.id)) return;
    let frontier = [...(start.parents ?? [])];
    const visited = new Set<string>([start.id]);

    for (let depth = 0; depth < 100 && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const parentId of frontier) {
        if (this.roots.has(parentId)) return;
        if (visited.has(parentId)) continue;
        visited.add(parentId);
        const parent = await this.getFile(parentId);
        next.push(...(parent.parents ?? []));
      }
      frontier = next;
    }

    throw new Error(
      `Drive item ${start.id} is outside the Artemis folder allowlist.`,
    );
  }
}

export const driveFilesEndpoint = DRIVE_FILES;
export const googleFolderMimeType = FOLDER_MIME;
