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

export class DriveAccess {
  constructor(private readonly api: GoogleApi) {}

  async assertAccessible(fileId: string): Promise<DriveFile> {
    return this.getFile(fileId);
  }

  async assertAccessibleFolder(folderId: string): Promise<DriveFile> {
    const folder = await this.getFile(folderId);
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
}

export const driveFilesEndpoint = DRIVE_FILES;
export const googleFolderMimeType = FOLDER_MIME;
