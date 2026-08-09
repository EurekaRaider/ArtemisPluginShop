import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { readArtemisAuth } from "../shared/artemis-auth.js";
import {
  DriveBoundary,
  driveFilesEndpoint,
  googleFolderMimeType,
  type DriveFile,
} from "../shared/drive-boundary.js";
import {
  GoogleApi,
  googleJsonBody,
  textResult,
  withQuery,
} from "../shared/google-api.js";
import {
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../shared/local-files.js";

const server = new McpServer({
  name: "Artemis Google Workspace",
  version: "1.0.0",
});

type ToolExtra = { _meta?: Record<string, unknown>; signal: AbortSignal };

function context(extra: ToolExtra) {
  const auth = readArtemisAuth(extra._meta);
  const api = new GoogleApi(auth, extra.signal);
  return { auth, api, drive: new DriveBoundary(api, auth) };
}

function assertCalendarAllowed(
  calendarId: string,
  extra: ToolExtra,
): GoogleApi {
  const auth = readArtemisAuth(extra._meta);
  const api = new GoogleApi(auth, extra.signal);
  const allowed = new Set(["primary", ...(auth.config.calendarIds ?? [])]);
  if (!allowed.has(calendarId)) {
    throw new Error(`Calendar ${calendarId} is not enabled in Artemis.`);
  }
  return api;
}

server.registerTool(
  "google_workspace_status",
  {
    description:
      "Show the Google account and local Workspace boundaries supplied by Artemis.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async (_input, extra) => {
    const auth = readArtemisAuth(extra._meta);
    return textResult({
      connected: true,
      accountEmail: auth.accountEmail,
      driveRootIds: auth.config.driveRootIds ?? [],
      calendarIds: ["primary", ...(auth.config.calendarIds ?? [])],
      notice:
        "Google grants full Drive access; this plugin enforces the listed roots locally on every call.",
    });
  },
);

server.registerTool(
  "gdrive_search",
  {
    description:
      "Search Drive, returning only items whose current parent chain is inside an enabled root.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe(
          "Drive API q expression, for example name contains 'budget'.",
        ),
      pageSize: z.number().int().min(1).max(100).default(25),
      pageToken: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ query, pageSize, pageToken }, extra) => {
    const { api, drive } = context(extra);
    const url = withQuery(driveFilesEndpoint, {
      q: query,
      pageSize,
      pageToken,
      spaces: "drive",
      corpora: "allDrives",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields:
        "nextPageToken,files(id,name,mimeType,parents,trashed,driveId,size,webViewLink,shortcutDetails(targetId,targetMimeType))",
    });
    const page = await api.json<{
      nextPageToken?: string;
      files?: DriveFile[];
    }>(url, {}, { readOnly: true });
    const files: DriveFile[] = [];
    for (const file of page.files ?? []) {
      try {
        await drive.assertAllowed(file.id);
        files.push(file);
      } catch {
        // Search is intentionally filtered to the configured boundary.
      }
    }
    return textResult({ files, nextPageToken: page.nextPageToken });
  },
);

server.registerTool(
  "gdrive_get",
  {
    description: "Read metadata for a Drive item inside an enabled root.",
    inputSchema: { fileId: z.string().min(1) },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ fileId }, extra) =>
    textResult(await context(extra).drive.assertAllowed(fileId)),
);

server.registerTool(
  "gdrive_download",
  {
    description:
      "Download a Drive file to a new path in the active Artemis workspace.",
    inputSchema: {
      fileId: z.string().min(1),
      outputPath: z
        .string()
        .min(1)
        .describe(
          "Workspace-relative destination; an existing file is never overwritten.",
        ),
      exportMimeType: z
        .string()
        .optional()
        .describe("Required for Google Docs, Sheets, or Slides files."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ fileId, outputPath, exportMimeType }, extra) => {
    const { api, drive } = context(extra);
    const file = await drive.assertAllowed(fileId);
    const isGoogleFile =
      file.mimeType?.startsWith("application/vnd.google-apps.") === true;
    if (isGoogleFile && !exportMimeType)
      throw new Error("exportMimeType is required for a Google-native file.");
    const url = isGoogleFile
      ? withQuery(
          `${driveFilesEndpoint}/${encodeURIComponent(fileId)}/export`,
          { mimeType: exportMimeType },
        )
      : withQuery(`${driveFilesEndpoint}/${encodeURIComponent(fileId)}`, {
          alt: "media",
          supportsAllDrives: true,
        });
    const data = await api.bytes(url, {}, { readOnly: true });
    const path = await writeWorkspaceFile(outputPath, data);
    return textResult({ fileId, path, bytes: data.byteLength });
  },
);

server.registerTool(
  "gdrive_upload",
  {
    description: "Upload a workspace file into an enabled Drive folder.",
    inputSchema: {
      localPath: z.string().min(1),
      parentId: z.string().min(1),
      name: z.string().min(1),
      mimeType: z.string().min(1).default("application/octet-stream"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async ({ localPath, parentId, name, mimeType }, extra) => {
    const { api, drive } = context(extra);
    await drive.assertAllowedFolder(parentId);
    const bytes = await readWorkspaceFile(localPath);
    const boundary = `artemis-${crypto.randomUUID()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify({ name, parents: [parentId] }),
      `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      Buffer.from(bytes),
      `\r\n--${boundary}--`,
    ]);
    const url = withQuery("https://www.googleapis.com/upload/drive/v3/files", {
      uploadType: "multipart",
      supportsAllDrives: true,
      fields: "id,name,mimeType,parents,driveId,webViewLink",
    });
    const file = await api.json<DriveFile>(url, {
      method: "POST",
      body,
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    });
    return textResult(file);
  },
);

server.registerTool(
  "gdrive_create_folder",
  {
    description: "Create a folder in an enabled Drive folder.",
    inputSchema: { parentId: z.string().min(1), name: z.string().min(1) },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async ({ parentId, name }, extra) => {
    const { api, drive } = context(extra);
    await drive.assertAllowedFolder(parentId);
    const url = withQuery(driveFilesEndpoint, {
      supportsAllDrives: true,
      fields: "id,name,mimeType,parents,driveId,webViewLink",
    });
    return textResult(
      await api.json<DriveFile>(url, {
        method: "POST",
        ...googleJsonBody({
          name,
          mimeType: googleFolderMimeType,
          parents: [parentId],
        }),
      }),
    );
  },
);

server.registerTool(
  "gdrive_copy",
  {
    description: "Copy a Drive file into an enabled folder.",
    inputSchema: {
      fileId: z.string().min(1),
      parentId: z.string().min(1),
      name: z.string().optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async ({ fileId, parentId, name }, extra) => {
    const { api, drive } = context(extra);
    await Promise.all([
      drive.assertAllowed(fileId),
      drive.assertAllowedFolder(parentId),
    ]);
    const url = withQuery(
      `${driveFilesEndpoint}/${encodeURIComponent(fileId)}/copy`,
      {
        supportsAllDrives: true,
        fields: "id,name,mimeType,parents,driveId,webViewLink",
      },
    );
    return textResult(
      await api.json(url, {
        method: "POST",
        ...googleJsonBody({ ...(name ? { name } : {}), parents: [parentId] }),
      }),
    );
  },
);

server.registerTool(
  "gdrive_move",
  {
    description: "Move a Drive item to another enabled folder.",
    inputSchema: { fileId: z.string().min(1), parentId: z.string().min(1) },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async ({ fileId, parentId }, extra) => {
    const { api, drive } = context(extra);
    const [file] = await Promise.all([
      drive.assertAllowed(fileId),
      drive.assertAllowedFolder(parentId),
    ]);
    const url = withQuery(
      `${driveFilesEndpoint}/${encodeURIComponent(fileId)}`,
      {
        addParents: parentId,
        removeParents: (file.parents ?? []).join(","),
        supportsAllDrives: true,
        fields: "id,name,mimeType,parents,driveId,webViewLink",
      },
    );
    return textResult(
      await api.json(url, { method: "PATCH", ...googleJsonBody({}) }),
    );
  },
);

server.registerTool(
  "gdrive_rename",
  {
    description: "Rename a Drive item inside an enabled root.",
    inputSchema: { fileId: z.string().min(1), name: z.string().min(1) },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ fileId, name }, extra) => {
    const { api, drive } = context(extra);
    await drive.assertAllowed(fileId);
    const url = withQuery(
      `${driveFilesEndpoint}/${encodeURIComponent(fileId)}`,
      {
        supportsAllDrives: true,
        fields: "id,name,mimeType,parents,driveId,webViewLink",
      },
    );
    return textResult(
      await api.json(url, { method: "PATCH", ...googleJsonBody({ name }) }),
    );
  },
);

for (const [name, trashed, description] of [
  ["gdrive_trash", true, "Move a Drive item to trash."],
  ["gdrive_restore", false, "Restore a Drive item from trash."],
] as const) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: { fileId: z.string().min(1) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ fileId }, extra) => {
      const { api, drive } = context(extra);
      await drive.assertAllowed(fileId);
      const url = withQuery(
        `${driveFilesEndpoint}/${encodeURIComponent(fileId)}`,
        {
          supportsAllDrives: true,
          fields: "id,name,mimeType,parents,trashed,driveId,webViewLink",
        },
      );
      return textResult(
        await api.json(url, {
          method: "PATCH",
          ...googleJsonBody({ trashed }),
        }),
      );
    },
  );
}

registerGoogleFileTools(
  "gdocs",
  "application/vnd.google-apps.document",
  "https://docs.googleapis.com/v1/documents",
);
registerGoogleFileTools(
  "gslides",
  "application/vnd.google-apps.presentation",
  "https://slides.googleapis.com/v1/presentations",
);

function registerGoogleFileTools(
  prefix: "gdocs" | "gslides",
  mimeType: string,
  apiRoot: string,
): void {
  const singular = prefix === "gdocs" ? "document" : "presentation";
  server.registerTool(
    `${prefix}_read`,
    {
      description: `Read a Google ${singular} inside an enabled Drive root.`,
      inputSchema: { fileId: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ fileId }, extra) => {
      const { api, drive } = context(extra);
      await drive.assertAllowed(fileId);
      return textResult(
        await api.json(
          `${apiRoot}/${encodeURIComponent(fileId)}`,
          {},
          { readOnly: true },
        ),
      );
    },
  );

  server.registerTool(
    `${prefix}_create`,
    {
      description: `Create a Google ${singular} in an enabled Drive folder.`,
      inputSchema: { parentId: z.string().min(1), title: z.string().min(1) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ parentId, title }, extra) => {
      const { api, drive } = context(extra);
      await drive.assertAllowedFolder(parentId);
      const url = withQuery(driveFilesEndpoint, {
        supportsAllDrives: true,
        fields: "id,name,mimeType,parents,driveId,webViewLink",
      });
      return textResult(
        await api.json(url, {
          method: "POST",
          ...googleJsonBody({ name: title, mimeType, parents: [parentId] }),
        }),
      );
    },
  );

  server.registerTool(
    `${prefix}_batch_update`,
    {
      description: `Apply structured Google ${singular} API batchUpdate requests.`,
      inputSchema: {
        fileId: z.string().min(1),
        requests: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      },
    },
    async ({ fileId, requests }, extra) => {
      const { api, drive } = context(extra);
      await drive.assertAllowed(fileId);
      return textResult(
        await api.json(`${apiRoot}/${encodeURIComponent(fileId)}:batchUpdate`, {
          method: "POST",
          ...googleJsonBody({ requests }),
        }),
      );
    },
  );
}

server.registerTool(
  "gsheets_read",
  {
    description:
      "Read metadata or a value range from a Google Sheet in an enabled Drive root.",
    inputSchema: {
      spreadsheetId: z.string().min(1),
      range: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ spreadsheetId, range }, extra) => {
    const { api, drive } = context(extra);
    await drive.assertAllowed(spreadsheetId);
    const url = range
      ? withQuery(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
          {},
        )
      : withQuery(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
          {
            includeGridData: false,
          },
        );
    return textResult(await api.json(url, {}, { readOnly: true }));
  },
);

server.registerTool(
  "gsheets_create",
  {
    description: "Create a Google Sheet in an enabled Drive folder.",
    inputSchema: { parentId: z.string().min(1), title: z.string().min(1) },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async ({ parentId, title }, extra) => {
    const { api, drive } = context(extra);
    await drive.assertAllowedFolder(parentId);
    const url = withQuery(driveFilesEndpoint, {
      supportsAllDrives: true,
      fields: "id,name,mimeType,parents,driveId,webViewLink",
    });
    return textResult(
      await api.json(url, {
        method: "POST",
        ...googleJsonBody({
          name: title,
          mimeType: "application/vnd.google-apps.spreadsheet",
          parents: [parentId],
        }),
      }),
    );
  },
);

for (const operation of ["update", "append"] as const) {
  server.registerTool(
    `gsheets_${operation}`,
    {
      description: `${operation === "update" ? "Replace" : "Append"} values in a Google Sheet range.`,
      inputSchema: {
        spreadsheetId: z.string().min(1),
        range: z.string().min(1),
        values: z.array(
          z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
        ),
        valueInputOption: z
          .enum(["RAW", "USER_ENTERED"])
          .default("USER_ENTERED"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: operation === "update",
        idempotentHint: operation === "update",
      },
    },
    async ({ spreadsheetId, range, values, valueInputOption }, extra) => {
      const { api, drive } = context(extra);
      await drive.assertAllowed(spreadsheetId);
      const url = withQuery(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}${operation === "append" ? ":append" : ""}`,
        { valueInputOption },
      );
      return textResult(
        await api.json(url, {
          method: operation === "append" ? "POST" : "PUT",
          ...googleJsonBody({ range, majorDimension: "ROWS", values }),
        }),
      );
    },
  );
}

server.registerTool(
  "gsheets_clear",
  {
    description: "Clear all values in a Google Sheet range.",
    inputSchema: { spreadsheetId: z.string().min(1), range: z.string().min(1) },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({ spreadsheetId, range }, extra) => {
    const { api, drive } = context(extra);
    await drive.assertAllowed(spreadsheetId);
    return textResult(
      await api.json(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
        { method: "POST", ...googleJsonBody({}) },
      ),
    );
  },
);

server.registerTool(
  "gcalendar_list_events",
  {
    description:
      "List events from the primary calendar or another calendar explicitly enabled in Artemis.",
    inputSchema: {
      calendarId: z.string().default("primary"),
      timeMin: z.string().optional(),
      timeMax: z.string().optional(),
      query: z.string().optional(),
      pageToken: z.string().optional(),
      maxResults: z.number().int().min(1).max(250).default(50),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async (
    { calendarId, timeMin, timeMax, query, pageToken, maxResults },
    extra,
  ) => {
    const api = assertCalendarAllowed(calendarId, extra);
    const url = withQuery(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        timeMin,
        timeMax,
        q: query,
        pageToken,
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
      },
    );
    return textResult(await api.json(url, {}, { readOnly: true }));
  },
);

server.registerTool(
  "gcalendar_get_event",
  {
    description: "Read a Calendar event.",
    inputSchema: {
      calendarId: z.string().default("primary"),
      eventId: z.string().min(1),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ calendarId, eventId }, extra) => {
    const api = assertCalendarAllowed(calendarId, extra);
    return textResult(
      await api.json(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        {},
        { readOnly: true },
      ),
    );
  },
);

server.registerTool(
  "gcalendar_create_event",
  {
    description:
      "Create a Calendar event. Artemis will confirm when attendees are present.",
    inputSchema: {
      calendarId: z.string().default("primary"),
      event: z.record(z.string(), z.unknown()),
      sendUpdates: z.enum(["all", "externalOnly", "none"]).default("none"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async ({ calendarId, event, sendUpdates }, extra) => {
    const api = assertCalendarAllowed(calendarId, extra);
    const url = withQuery(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        sendUpdates,
      },
    );
    return textResult(
      await api.json(url, { method: "POST", ...googleJsonBody(event) }),
    );
  },
);

server.registerTool(
  "gcalendar_update_event",
  {
    description:
      "Patch a Calendar event. Artemis shows a confirmation summary before execution.",
    inputSchema: {
      calendarId: z.string().default("primary"),
      eventId: z.string().min(1),
      patch: z.record(z.string(), z.unknown()),
      sendUpdates: z.enum(["all", "externalOnly", "none"]).default("none"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async ({ calendarId, eventId, patch, sendUpdates }, extra) => {
    const api = assertCalendarAllowed(calendarId, extra);
    const url = withQuery(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { sendUpdates },
    );
    return textResult(
      await api.json(url, { method: "PATCH", ...googleJsonBody(patch) }),
    );
  },
);

server.registerTool(
  "gcalendar_cancel_event",
  {
    description: "Cancel a Calendar event without permanently deleting it.",
    inputSchema: {
      calendarId: z.string().default("primary"),
      eventId: z.string().min(1),
      sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({ calendarId, eventId, sendUpdates }, extra) => {
    const api = assertCalendarAllowed(calendarId, extra);
    const url = withQuery(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { sendUpdates },
    );
    return textResult(
      await api.json(url, {
        method: "PATCH",
        ...googleJsonBody({ status: "cancelled" }),
      }),
    );
  },
);

await server.connect(new StdioServerTransport());
