import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readConnectorAuth } from "../shared/connector-auth.js";
import { GraphApi } from "../shared/graph-api.js";
import { textResult } from "../shared/google-api.js";
import {
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../shared/local-files.js";

const server = new McpServer({ name: "Artemis Outlook", version: "0.2.0" });
type Extra = { _meta?: Record<string, unknown>; signal: AbortSignal };
const id = z.string().min(1).max(2048);
const recipients = z.array(z.string().email()).max(100);
const message = {
  to: recipients,
  cc: recipients.default([]),
  bcc: recipients.default([]),
  subject: z.string().max(998),
  text: z.string().max(1_000_000),
  attachments: z
    .array(
      z.object({ path: z.string().min(1), name: z.string().min(1).max(255) }),
    )
    .max(10)
    .default([]),
};
const api = (extra: Extra) =>
  new GraphApi(readConnectorAuth(extra._meta, "microsoft"), extra.signal);
const path = (messageId: string) =>
  `/me/messages/${encodeURIComponent(messageId)}`;
const readonly = { readOnlyHint: true, destructiveHint: false };
const write = { readOnlyHint: false, destructiveHint: false };
async function content(input: z.infer<z.ZodObject<typeof message>>) {
  const addresses = (items: string[]) =>
    items.map((address) => ({ emailAddress: { address } }));
  const attachments = await Promise.all(
    input.attachments.map(async (file) => {
      const bytes = await readWorkspaceFile(file.path);
      if (bytes.length > 3 * 1024 * 1024)
        throw new Error(
          "Outlook attachments are limited to 3 MiB each in this release.",
        );
      return {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: file.name,
        contentBytes: Buffer.from(bytes).toString("base64"),
      };
    }),
  );
  return {
    subject: input.subject,
    body: { contentType: "Text", content: input.text },
    toRecipients: addresses(input.to),
    ccRecipients: addresses(input.cc),
    bccRecipients: addresses(input.bcc),
    attachments,
  };
}
server.registerTool(
  "outlook_search",
  {
    description:
      "Search mail. nextSkip is a numeric cursor from a previous response.",
    inputSchema: {
      query: z.string().max(1000).default(""),
      folder: id.default("inbox"),
      skip: z.number().int().min(0).max(1_000_000).default(0),
      limit: z.number().int().min(1).max(100).default(25),
    },
    annotations: readonly,
  },
  async ({ query, folder, skip, limit }, extra) => {
    const params = new URLSearchParams({
      $top: String(limit),
      $skip: String(skip),
      $select:
        "id,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview",
    });
    if (query) params.set("$search", JSON.stringify(query));
    return textResult(
      await api(extra).request(
        `/me/mailFolders/${encodeURIComponent(folder)}/messages?${params}`,
      ),
    );
  },
);
server.registerTool(
  "outlook_read",
  {
    description: "Read a message as text.",
    inputSchema: { messageId: id },
    annotations: readonly,
  },
  async ({ messageId }, extra) =>
    textResult(await api(extra).request(path(messageId))),
);
server.registerTool(
  "outlook_folders",
  { description: "List mail folders.", inputSchema: {}, annotations: readonly },
  async (_, extra) =>
    textResult(await api(extra).request("/me/mailFolders?$top=100")),
);
server.registerTool(
  "outlook_attachments",
  {
    description: "List attachment metadata without downloading content.",
    inputSchema: { messageId: id },
    annotations: readonly,
  },
  async ({ messageId }, extra) =>
    textResult(
      await api(extra).request(
        `${path(messageId)}/attachments?$select=id,name,size,contentType,isInline`,
      ),
    ),
);
server.registerTool(
  "outlook_save_attachment",
  {
    description:
      "Save a file attachment to a new file inside the active workspace.",
    inputSchema: {
      messageId: id,
      attachmentId: id,
      destination: z.string().min(1),
    },
    annotations: write,
  },
  async ({ messageId, attachmentId, destination }, extra) => {
    const item = await api(extra).request(
      `${path(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    if (
      item["@odata.type"] !== "#microsoft.graph.fileAttachment" ||
      typeof item.contentBytes !== "string"
    )
      throw new Error("Only file attachments can be downloaded.");
    return textResult({
      path: await writeWorkspaceFile(
        destination,
        Buffer.from(item.contentBytes, "base64"),
      ),
    });
  },
);
server.registerTool(
  "outlook_create_draft",
  {
    description: "Create an editable draft. Does not send mail.",
    inputSchema: message,
    annotations: write,
  },
  async (input, extra) => {
    const transport = api(extra);
    return textResult(
      await transport.request("/me/messages", "POST", await content(input)),
    );
  },
);
server.registerTool(
  "outlook_send",
  {
    description:
      "Send a new message once. A successful response means accepted, not proof of delivery. Never automatically retry an uncertain result.",
    inputSchema: message,
    annotations: write,
  },
  async (input, extra) => {
    const transport = api(extra);
    return textResult(
      await transport.request("/me/sendMail", "POST", {
        message: await content(input),
        saveToSentItems: true,
      }),
    );
  },
);
server.registerTool(
  "outlook_send_draft",
  {
    description:
      "Send an existing draft once; never automatically retry an uncertain result.",
    inputSchema: { messageId: id },
    annotations: write,
  },
  async ({ messageId }, extra) => {
    const transport = api(extra),
      draft = await transport.request(`${path(messageId)}?$select=isDraft`);
    if (!draft.isDraft) throw new Error("This message is not a draft.");
    return textResult(
      await transport.request(`${path(messageId)}/send`, "POST"),
    );
  },
);
server.registerTool(
  "outlook_reply",
  {
    description:
      "Reply once to the message sender. Never automatically retry an uncertain result.",
    inputSchema: { messageId: id, text: z.string().max(1_000_000) },
    annotations: write,
  },
  async ({ messageId, text }, extra) =>
    textResult(
      await api(extra).request(`${path(messageId)}/reply`, "POST", {
        comment: text,
      }),
    ),
);
server.registerTool(
  "outlook_forward",
  {
    description:
      "Forward once to explicit recipients. Never automatically retry an uncertain result.",
    inputSchema: {
      messageId: id,
      to: recipients.min(1),
      text: z.string().max(1_000_000).default(""),
    },
    annotations: write,
  },
  async ({ messageId, to, text }, extra) =>
    textResult(
      await api(extra).request(`${path(messageId)}/forward`, "POST", {
        comment: text,
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      }),
    ),
);
server.registerTool(
  "outlook_update",
  {
    description: "Mark read/unread and set categories.",
    inputSchema: {
      messageId: id,
      isRead: z.boolean().optional(),
      categories: z.array(z.string().max(255)).max(30).optional(),
    },
    annotations: write,
  },
  async ({ messageId, ...update }, extra) =>
    textResult(await api(extra).request(path(messageId), "PATCH", update)),
);
server.registerTool(
  "outlook_move",
  {
    description:
      "Move mail to a folder, including deleteditems for recoverable trash. No permanent deletion.",
    inputSchema: { messageId: id, destinationId: id },
    annotations: write,
  },
  async ({ messageId, destinationId }, extra) =>
    textResult(
      await api(extra).request(`${path(messageId)}/move`, "POST", {
        destinationId,
      }),
    ),
);
await server.connect(new StdioServerTransport());
