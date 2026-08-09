import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { readArtemisAuth } from "../shared/artemis-auth.js";
import {
  GoogleApi,
  googleJsonBody,
  textResult,
  withQuery,
} from "../shared/google-api.js";
import {
  buildRawMime,
  decodeBase64Url,
  type Mailbox,
  type MimeAttachment,
} from "../shared/gmail-mime.js";
import {
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../shared/local-files.js";

const GMAIL_ROOT = "https://gmail.googleapis.com/gmail/v1/users/me";
const server = new McpServer({ name: "Artemis Gmail", version: "1.0.0" });

type ToolExtra = { _meta?: Record<string, unknown>; signal: AbortSignal };
type Header = { name?: string; value?: string };
type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: Header[];
    parts?: unknown[];
    body?: { data?: string; attachmentId?: string; size?: number };
  };
};

const mailboxSchema = z.object({
  name: z.string().optional(),
  email: z.string().email(),
});
const attachmentSchema = z.object({
  localPath: z.string().min(1),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
});

function context(extra: ToolExtra) {
  const auth = readArtemisAuth(extra._meta);
  return { auth, api: new GoogleApi(auth, extra.signal) };
}

server.registerTool(
  "gmail_status",
  {
    description:
      "Show the Google account connected to this isolated Gmail grant.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async (_input, extra) => {
    const { auth } = context(extra);
    return textResult({
      connected: true,
      accountEmail: auth.accountEmail,
      grant: "gmail",
      scope: "gmail.modify",
    });
  },
);

server.registerTool(
  "gmail_search_threads",
  {
    description: "Search Gmail threads with Gmail query syntax.",
    inputSchema: {
      query: z.string().default(""),
      pageToken: z.string().optional(),
      maxResults: z.number().int().min(1).max(100).default(25),
      includeSpamTrash: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ query, pageToken, maxResults, includeSpamTrash }, extra) => {
    const { api } = context(extra);
    const url = withQuery(`${GMAIL_ROOT}/threads`, {
      q: query,
      pageToken,
      maxResults,
      includeSpamTrash,
    });
    return textResult(await api.json(url, {}, { readOnly: true }));
  },
);

server.registerTool(
  "gmail_get_thread",
  {
    description:
      "Read a Gmail thread including message headers and decoded body data supplied by Gmail.",
    inputSchema: {
      threadId: z.string().min(1),
      format: z.enum(["full", "metadata", "minimal"]).default("full"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ threadId, format }, extra) => {
    const { api } = context(extra);
    const url = withQuery(
      `${GMAIL_ROOT}/threads/${encodeURIComponent(threadId)}`,
      { format },
    );
    const thread = await api.json<{ messages?: GmailMessage[] }>(
      url,
      {},
      { readOnly: true },
    );
    return textResult({
      ...thread,
      messages: thread.messages?.map((message) => ({
        ...message,
        payload: decodeTextBodies(message.payload),
      })),
    });
  },
);

server.registerTool(
  "gmail_get_attachment",
  {
    description:
      "Download a Gmail attachment to a new path inside the active Artemis workspace.",
    inputSchema: {
      messageId: z.string().min(1),
      attachmentId: z.string().min(1),
      outputPath: z.string().min(1),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ messageId, attachmentId, outputPath }, extra) => {
    const { api } = context(extra);
    const attachment = await api.json<{ data: string; size: number }>(
      `${GMAIL_ROOT}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      {},
      { readOnly: true },
    );
    const data = decodeBase64Url(attachment.data);
    const path = await writeWorkspaceFile(outputPath, data);
    return textResult({
      messageId,
      attachmentId,
      path,
      bytes: data.byteLength,
    });
  },
);

server.registerTool(
  "gmail_list_drafts",
  {
    description: "List Gmail drafts.",
    inputSchema: {
      pageToken: z.string().optional(),
      maxResults: z.number().int().min(1).max(100).default(25),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ pageToken, maxResults }, extra) => {
    const { api } = context(extra);
    return textResult(
      await api.json(
        withQuery(`${GMAIL_ROOT}/drafts`, { pageToken, maxResults }),
        {},
        { readOnly: true },
      ),
    );
  },
);

server.registerTool(
  "gmail_get_draft",
  {
    description: "Read one Gmail draft without sending it.",
    inputSchema: {
      draftId: z.string().min(1),
      format: z.enum(["full", "metadata", "minimal", "raw"]).default("full"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ draftId, format }, extra) => {
    const { api } = context(extra);
    return textResult(
      await api.json(
        withQuery(`${GMAIL_ROOT}/drafts/${encodeURIComponent(draftId)}`, {
          format,
        }),
        {},
        { readOnly: true },
      ),
    );
  },
);

server.registerTool(
  "gmail_create_draft",
  {
    description: "Create a Gmail draft without sending it.",
    inputSchema: messageInputSchema(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async (input, extra) => {
    const { api } = context(extra);
    const raw = await rawFromInput(input);
    return textResult(
      await api.json(`${GMAIL_ROOT}/drafts`, {
        method: "POST",
        ...googleJsonBody({ message: { raw } }),
      }),
    );
  },
);

server.registerTool(
  "gmail_update_draft",
  {
    description: "Replace the content of an existing Gmail draft.",
    inputSchema: { draftId: z.string().min(1), ...messageInputSchema() },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({ draftId, ...input }, extra) => {
    const { api } = context(extra);
    const raw = await rawFromInput(input);
    return textResult(
      await api.json(`${GMAIL_ROOT}/drafts/${encodeURIComponent(draftId)}`, {
        method: "PUT",
        ...googleJsonBody({ id: draftId, message: { raw } }),
      }),
    );
  },
);

server.registerTool(
  "gmail_delete_draft",
  {
    description:
      "Delete a Gmail draft. This does not delete a sent or received message.",
    inputSchema: { draftId: z.string().min(1) },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async ({ draftId }, extra) => {
    const { api } = context(extra);
    await api.json(`${GMAIL_ROOT}/drafts/${encodeURIComponent(draftId)}`, {
      method: "DELETE",
    });
    return textResult({ deletedDraftId: draftId });
  },
);

server.registerTool(
  "gmail_send_draft",
  {
    description:
      "Send an existing Gmail draft after Artemis confirms the recipient summary.",
    inputSchema: { draftId: z.string().min(1) },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async ({ draftId }, extra) => {
    const { api } = context(extra);
    return textResult(
      await api.json(`${GMAIL_ROOT}/drafts/send`, {
        method: "POST",
        ...googleJsonBody({ id: draftId }),
      }),
    );
  },
);

server.registerTool(
  "gmail_send_message",
  {
    description:
      "Send a new Gmail message after Artemis confirms recipients and subject.",
    inputSchema: messageInputSchema(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async (input, extra) => {
    const { api } = context(extra);
    const raw = await rawFromInput(input);
    return textResult(
      await api.json(`${GMAIL_ROOT}/messages/send`, {
        method: "POST",
        ...googleJsonBody({ raw }),
      }),
    );
  },
);

server.registerTool(
  "gmail_reply",
  {
    description:
      "Reply in a Gmail thread with RFC-compliant thread and message reference headers.",
    inputSchema: {
      messageId: z.string().min(1).describe("Message being replied to."),
      text: z.string().min(1),
      html: z.string().optional(),
      cc: z.array(mailboxSchema).optional(),
      attachments: z.array(attachmentSchema).max(10).optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async ({ messageId, text, html, cc, attachments }, extra) => {
    const { api } = context(extra);
    const original = await getMessageMetadata(api, messageId);
    if (!original.threadId)
      throw new Error("The Gmail message has no threadId.");
    const headers = headerMap(original.payload?.headers);
    const replyTarget = parseMailbox(
      headers.get("reply-to") ?? headers.get("from"),
    );
    const originalMessageId = headers.get("message-id");
    if (!replyTarget || !originalMessageId)
      throw new Error("The original message lacks reply routing headers.");
    const references = [headers.get("references"), originalMessageId]
      .filter(Boolean)
      .join(" ");
    const raw = buildRawMime({
      to: [replyTarget],
      cc,
      subject: replySubject(headers.get("subject") ?? ""),
      text,
      html,
      attachments: await loadAttachments(attachments),
      headers: { "In-Reply-To": originalMessageId, References: references },
    });
    return textResult(
      await api.json(`${GMAIL_ROOT}/messages/send`, {
        method: "POST",
        ...googleJsonBody({ raw, threadId: original.threadId }),
      }),
    );
  },
);

server.registerTool(
  "gmail_forward",
  {
    description:
      "Forward a Gmail message to explicit recipients after Artemis confirmation.",
    inputSchema: {
      messageId: z.string().min(1),
      to: z.array(mailboxSchema).min(1),
      cc: z.array(mailboxSchema).optional(),
      text: z.string().min(1),
      html: z.string().optional(),
      attachments: z.array(attachmentSchema).max(10).optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async ({ messageId, to, cc, text, html, attachments }, extra) => {
    const { api } = context(extra);
    const original = await getMessageMetadata(api, messageId);
    const headers = headerMap(original.payload?.headers);
    const raw = buildRawMime({
      to,
      cc,
      subject: forwardSubject(headers.get("subject") ?? ""),
      text,
      html,
      attachments: await loadAttachments(attachments),
      headers: headers.get("message-id")
        ? { "X-Forwarded-Message-Id": headers.get("message-id")! }
        : undefined,
    });
    return textResult(
      await api.json(`${GMAIL_ROOT}/messages/send`, {
        method: "POST",
        ...googleJsonBody({ raw }),
      }),
    );
  },
);

server.registerTool(
  "gmail_list_labels",
  {
    description: "List Gmail system and user labels.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async (_input, extra) =>
    textResult(
      await context(extra).api.json(
        `${GMAIL_ROOT}/labels`,
        {},
        { readOnly: true },
      ),
    ),
);

server.registerTool(
  "gmail_create_label",
  {
    description: "Create a Gmail label.",
    inputSchema: {
      name: z.string().min(1),
      labelListVisibility: z
        .enum(["labelShow", "labelShowIfUnread", "labelHide"])
        .default("labelShow"),
      messageListVisibility: z.enum(["show", "hide"]).default("show"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  async (input, extra) =>
    textResult(
      await context(extra).api.json(`${GMAIL_ROOT}/labels`, {
        method: "POST",
        ...googleJsonBody(input),
      }),
    ),
);

server.registerTool(
  "gmail_update_label",
  {
    description: "Update the name or visibility of a user Gmail label.",
    inputSchema: {
      labelId: z.string().min(1),
      name: z.string().optional(),
      labelListVisibility: z
        .enum(["labelShow", "labelShowIfUnread", "labelHide"])
        .optional(),
      messageListVisibility: z.enum(["show", "hide"]).optional(),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  async ({ labelId, ...patch }, extra) =>
    textResult(
      await context(extra).api.json(
        `${GMAIL_ROOT}/labels/${encodeURIComponent(labelId)}`,
        {
          method: "PATCH",
          ...googleJsonBody(patch),
        },
      ),
    ),
);

server.registerTool(
  "gmail_delete_label",
  {
    description:
      "Delete a user Gmail label after Artemis confirmation. Messages are retained.",
    inputSchema: { labelId: z.string().min(1) },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  async ({ labelId }, extra) => {
    await context(extra).api.json(
      `${GMAIL_ROOT}/labels/${encodeURIComponent(labelId)}`,
      { method: "DELETE" },
    );
    return textResult({ deletedLabelId: labelId });
  },
);

server.registerTool(
  "gmail_modify_thread",
  {
    description:
      "Add or remove labels on a thread; remove INBOX to archive and use UNREAD for read state.",
    inputSchema: {
      threadId: z.string().min(1),
      addLabelIds: z.array(z.string()).max(100).default([]),
      removeLabelIds: z.array(z.string()).max(100).default([]),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  async ({ threadId, addLabelIds, removeLabelIds }, extra) =>
    textResult(
      await context(extra).api.json(
        `${GMAIL_ROOT}/threads/${encodeURIComponent(threadId)}/modify`,
        {
          method: "POST",
          ...googleJsonBody({ addLabelIds, removeLabelIds }),
        },
      ),
    ),
);

for (const operation of ["trash", "untrash"] as const) {
  server.registerTool(
    `gmail_${operation}_thread`,
    {
      description:
        operation === "trash"
          ? "Move a Gmail thread to trash."
          : "Restore a Gmail thread from trash.",
      inputSchema: { threadId: z.string().min(1) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
    async ({ threadId }, extra) =>
      textResult(
        await context(extra).api.json(
          `${GMAIL_ROOT}/threads/${encodeURIComponent(threadId)}/${operation}`,
          {
            method: "POST",
            ...googleJsonBody({}),
          },
        ),
      ),
  );
}

function messageInputSchema() {
  return {
    to: z.array(mailboxSchema).min(1),
    cc: z.array(mailboxSchema).optional(),
    bcc: z.array(mailboxSchema).optional(),
    subject: z.string(),
    text: z.string().optional(),
    html: z.string().optional(),
    attachments: z.array(attachmentSchema).max(10).optional(),
  };
}

async function rawFromInput(input: {
  to: Mailbox[];
  cc?: Mailbox[];
  bcc?: Mailbox[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    localPath: string;
    filename: string;
    mimeType: string;
  }>;
}): Promise<string> {
  if (!input.text && !input.html)
    throw new Error("A text or HTML body is required.");
  return buildRawMime({
    ...input,
    attachments: await loadAttachments(input.attachments),
  });
}

async function loadAttachments(
  attachments:
    | Array<{ localPath: string; filename: string; mimeType: string }>
    | undefined,
): Promise<MimeAttachment[] | undefined> {
  if (!attachments?.length) return undefined;
  const result: MimeAttachment[] = [];
  let total = 0;
  for (const attachment of attachments) {
    const data = await readWorkspaceFile(attachment.localPath);
    total += data.byteLength;
    if (total > 24 * 1024 * 1024)
      throw new Error(
        "Combined Gmail attachments exceed the 24 MiB plugin limit.",
      );
    result.push({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      dataBase64: Buffer.from(data).toString("base64"),
    });
  }
  return result;
}

async function getMessageMetadata(
  api: GoogleApi,
  messageId: string,
): Promise<GmailMessage> {
  const url = withQuery(
    `${GMAIL_ROOT}/messages/${encodeURIComponent(messageId)}`,
    {
      format: "metadata",
    },
  );
  return await api.json<GmailMessage>(url, {}, { readOnly: true });
}

function decodeTextBodies(payload: GmailMessage["payload"]): unknown {
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const part = value as Record<string, unknown>;
    const body = part.body as { data?: unknown } | undefined;
    const mimeType = typeof part.mimeType === "string" ? part.mimeType : "";
    const decodedText =
      body &&
      typeof body.data === "string" &&
      (mimeType === "text/plain" || mimeType === "text/html")
        ? Buffer.from(body.data, "base64url").toString("utf8")
        : undefined;
    return {
      ...part,
      ...(body
        ? {
            body: {
              ...body,
              ...(decodedText !== undefined ? { decodedText } : {}),
            },
          }
        : {}),
      ...(Array.isArray(part.parts)
        ? { parts: part.parts.map((child) => visit(child)) }
        : {}),
    };
  };
  return visit(payload);
}

function headerMap(headers: Header[] | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const header of headers ?? []) {
    if (header.name && header.value)
      result.set(header.name.toLowerCase(), header.value);
  }
  return result;
}

function parseMailbox(value: string | undefined): Mailbox | undefined {
  if (!value || /[\r\n]/.test(value)) return undefined;
  const match = value.match(/^(.*?)\s*<([^<>]+)>$/);
  if (match)
    return {
      name: match[1]?.replace(/^"|"$/g, "").trim() || undefined,
      email: match[2]!.trim(),
    };
  const email = value.trim();
  return email.includes("@") ? { email } : undefined;
}

function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

function forwardSubject(subject: string): string {
  return /^fwd:/i.test(subject.trim()) ? subject : `Fwd: ${subject}`;
}

await server.connect(new StdioServerTransport());
