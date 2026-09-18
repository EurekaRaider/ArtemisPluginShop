import {
  McpServer,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { z } from "zod";
import { readConnectorAuth } from "../shared/connector-auth.js";
import { textResult } from "../shared/google-api.js";
import {
  readWorkspaceFile,
  writeWorkspaceFile,
} from "../shared/local-files.js";

const server = new McpServer({ name: "Artemis QQ Mail", version: "0.2.0" });
type Extra = { _meta?: Record<string, unknown>; signal: AbortSignal };
const folder = z.string().min(1).max(512);
const reference = {
  mailbox: folder,
  uid: z.number().int().positive(),
  uidValidity: z.string().regex(/^\d+$/),
};
const draft = {
  to: z.array(z.string().email()).min(1).max(100),
  cc: z.array(z.string().email()).max(100).default([]),
  bcc: z.array(z.string().email()).max(100).default([]),
  subject: z.string().max(998),
  text: z.string().max(1_000_000),
  attachments: z
    .array(
      z.object({
        path: z.string().min(1),
        filename: z.string().min(1).max(255),
      }),
    )
    .max(10)
    .default([]),
};
const read = { readOnlyHint: true, destructiveHint: false };
const write = { readOnlyHint: false, destructiveHint: false };
function credentials(extra: Extra) {
  const auth = readConnectorAuth(extra._meta, "qq");
  return { user: auth.account, pass: auth.appPassword };
}
function smtp(extra: Extra) {
  return nodemailer.createTransport({
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    auth: credentials(extra),
    logger: false,
    debug: false,
    connectionTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
async function imap<T>(
  extra: Extra,
  operation: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  extra.signal.throwIfAborted();
  const client = new ImapFlow({
    host: "imap.qq.com",
    port: 993,
    secure: true,
    auth: credentials(extra),
    logger: false,
    connectionTimeout: 15000,
    socketTimeout: 30000,
  });
  client.on("error", () => {});
  const abort = () => client.close();
  extra.signal.addEventListener("abort", abort, { once: true });
  try {
    await client.connect();
    extra.signal.throwIfAborted();
    return await operation(client);
  } finally {
    extra.signal.removeEventListener("abort", abort);
    client.close();
  }
}
async function locked<T>(
  client: ImapFlow,
  ref: z.infer<z.ZodObject<typeof reference>>,
  operation: () => Promise<T>,
) {
  const lock = await client.getMailboxLock(ref.mailbox);
  try {
    if (
      !client.mailbox ||
      String(client.mailbox.uidValidity) !== ref.uidValidity
    )
      throw new Error(
        "Mailbox identity changed. Search again before operating on this message.",
      );
    return await operation();
  } finally {
    lock.release();
  }
}
async function parsed(client: ImapFlow, uid: number) {
  const metadata = await client.fetchOne(uid, { size: true }, { uid: true });
  if (!metadata || (metadata.size ?? 0) > 25 * 1024 * 1024)
    throw new Error("Message is missing or exceeds the 25 MiB read limit.");
  const item = await client.fetchOne(uid, { source: true }, { uid: true });
  if (!item || !item.source) throw new Error("Message no longer exists.");
  return simpleParser(item.source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
  });
}
async function mailContent(
  input: z.infer<z.ZodObject<typeof draft>>,
  extra: Extra,
) {
  const auth = readConnectorAuth(extra._meta, "qq");
  const attachments = await Promise.all(
    input.attachments.map(async (item) => ({
      filename: item.filename,
      content: Buffer.from(await readWorkspaceFile(item.path)),
    })),
  );
  if (
    attachments.reduce((total, item) => total + item.content.length, 0) >
    20 * 1024 * 1024
  )
    throw new Error("Combined attachments exceed 20 MiB.");
  return {
    from: auth.account,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    attachments,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
// Strip library diagnostics so credentials and raw protocol responses never reach the model.
function register<S extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: S,
  annotations: typeof read,
  run: (input: z.infer<z.ZodObject<S>>, extra: Extra) => Promise<unknown>,
) {
  const handler = async (input: z.infer<z.ZodObject<S>>, extra: Extra) => {
    readConnectorAuth(extra._meta, "qq");
    try {
      return textResult(await run(input, extra));
    } catch {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: annotations.readOnlyHint
              ? "Mailbox operation failed. Check connection, message identity and size limits."
              : "Operation failed or its outcome is unknown. Verify mailbox state before retrying. Do not automatically resend.",
          },
        ],
      };
    }
  };
  server.registerTool(
    name,
    { description, inputSchema, annotations },
    handler as unknown as ToolCallback<S>,
  );
}
register(
  "mail_check_connection",
  "Verify IMAP login and SMTP authentication without sending mail.",
  {},
  read,
  async (_, extra) => {
    await imap(extra, async () => undefined);
    const transport = smtp(extra);
    try {
      extra.signal.throwIfAborted();
      await transport.verify();
      return { connected: true };
    } finally {
      transport.close();
    }
  },
);
register(
  "qq_mail_folders",
  "List folders and their special-use flags.",
  {},
  read,
  (_, extra) =>
    imap(extra, async (client) =>
      (await client.list()).map((item) => ({
        path: item.path,
        specialUse: item.specialUse,
      })),
    ),
);
register(
  "qq_mail_search",
  "Search messages. Use the returned UID and UIDVALIDITY together for subsequent actions.",
  {
    mailbox: folder.default("INBOX"),
    text: z.string().max(1000).default(""),
    unread: z.boolean().default(false),
    beforeUid: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(100).default(25),
  },
  read,
  (input, extra) =>
    imap(extra, async (client) => {
      const lock = await client.getMailboxLock(input.mailbox, {
        readOnly: true,
      });
      try {
        const ids = await client.search(
          {
            ...(input.text ? { text: input.text } : { all: true }),
            ...(input.unread ? { seen: false } : {}),
          },
          { uid: true },
        );
        const chosen = (ids || [])
          .filter((uid) => !input.beforeUid || uid < input.beforeUid)
          .sort((a, b) => b - a)
          .slice(0, input.limit);
        const messages = [];
        for (const uid of chosen) {
          const item = await client.fetchOne(
            uid,
            { envelope: true, flags: true, size: true },
            { uid: true },
          );
          if (item)
            messages.push({
              uid,
              envelope: item.envelope,
              flags: [...(item.flags ?? [])],
              size: item.size,
            });
        }
        return {
          mailbox: input.mailbox,
          uidValidity: client.mailbox
            ? String(client.mailbox.uidValidity)
            : undefined,
          messages,
          nextBeforeUid: chosen.at(-1),
        };
      } finally {
        lock.release();
      }
    }),
);
register(
  "qq_mail_read",
  "Read text and attachment metadata without loading remote images or marking read.",
  reference,
  read,
  (ref, extra) =>
    imap(extra, (client) =>
      locked(client, ref, async () => {
        const item = await parsed(client, ref.uid);
        return {
          subject: item.subject,
          from: item.from,
          to: item.to,
          cc: item.cc,
          date: item.date,
          messageId: item.messageId,
          text: (item.text ?? "").slice(0, 1_000_000),
          attachments: item.attachments.map((part, index) => ({
            index,
            filename: part.filename,
            contentType: part.contentType,
            size: part.size,
          })),
        };
      }),
    ),
);
register(
  "qq_mail_save_attachment",
  "Save an attachment to a new workspace file.",
  {
    ...reference,
    index: z.number().int().min(0),
    destination: z.string().min(1),
  },
  write,
  (ref, extra) =>
    imap(extra, (client) =>
      locked(client, ref, async () => {
        const item = (await parsed(client, ref.uid)).attachments[ref.index];
        if (!item) throw new Error("Attachment no longer exists.");
        return {
          path: await writeWorkspaceFile(ref.destination, item.content),
        };
      }),
    ),
);
register(
  "qq_mail_set_read",
  "Mark a message read or unread.",
  { ...reference, isRead: z.boolean() },
  write,
  (ref, extra) =>
    imap(extra, (client) =>
      locked(client, ref, async () => ({
        updated: await (ref.isRead
          ? client.messageFlagsAdd(ref.uid, ["\\Seen"], { uid: true })
          : client.messageFlagsRemove(ref.uid, ["\\Seen"], { uid: true })),
      })),
    ),
);
register(
  "qq_mail_move",
  "Move mail using IMAP MOVE. Use folders with Trash special-use for recoverable trash. Permanent deletion is unavailable.",
  { ...reference, destination: folder },
  write,
  (ref, extra) =>
    imap(extra, (client) =>
      locked(client, ref, async () => {
        if (!client.capabilities.has("MOVE"))
          throw new Error("Server does not support safe MOVE.");
        const moved = await client.messageMove(ref.uid, ref.destination, {
          uid: true,
        });
        return { moved: Boolean(moved) };
      }),
    ),
);
register(
  "qq_mail_create_draft",
  "Create a new draft; does not send mail.",
  draft,
  write,
  async (input, extra) => {
    const content = await mailContent(input, extra);
    const raw = await nodemailer
      .createTransport({
        streamTransport: true,
        buffer: true,
        newline: "windows",
      })
      .sendMail(content);
    return imap(extra, async (client) => {
      const drafts = (await client.list()).find(
        (item) => item.specialUse === "\\Drafts",
      );
      if (!drafts) throw new Error("Drafts folder is unavailable.");
      if (!Buffer.isBuffer(raw.message))
        throw new Error("MIME generation failed.");
      const result = await client.append(drafts.path, raw.message, [
        "\\Draft",
        "\\Seen",
      ]);
      return {
        saved: Boolean(result),
        mailbox: drafts.path,
        ...(result
          ? { uid: result.uid, uidValidity: String(result.uidValidity) }
          : {}),
      };
    });
  },
);
register(
  "qq_mail_send",
  "Send once through QQ SMTP. Accepted does not guarantee delivery. Never automatically retry an uncertain send.",
  draft,
  write,
  async (input, extra) => {
    const content = await mailContent(input, extra),
      transport = smtp(extra);
    const abort = () => transport.close();
    extra.signal.addEventListener("abort", abort, { once: true });
    try {
      extra.signal.throwIfAborted();
      const result = await transport.sendMail(content);
      return {
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      };
    } finally {
      extra.signal.removeEventListener("abort", abort);
      transport.close();
    }
  },
);
await server.connect(new StdioServerTransport());
