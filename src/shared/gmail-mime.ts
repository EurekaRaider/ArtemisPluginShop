export interface Mailbox {
  name?: string;
  email: string;
}

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

export interface MimeMessageInput {
  from?: Mailbox;
  to: Mailbox[];
  cc?: Mailbox[];
  bcc?: Mailbox[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: MimeAttachment[];
  headers?: Record<string, string>;
}

export function buildRawMime(input: MimeMessageInput): string {
  const boundary = `artemis-${crypto.randomUUID()}`;
  const headers = [
    input.from ? `From: ${mailbox(input.from)}` : undefined,
    `To: ${input.to.map(mailbox).join(", ")}`,
    input.cc?.length ? `Cc: ${input.cc.map(mailbox).join(", ")}` : undefined,
    input.bcc?.length ? `Bcc: ${input.bcc.map(mailbox).join(", ")}` : undefined,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    ...Object.entries(input.headers ?? {}).map(
      ([key, value]) => `${safeHeaderName(key)}: ${safeHeaderValue(value)}`,
    ),
  ].filter((value): value is string => Boolean(value));

  const attachments = input.attachments ?? [];
  if (attachments.length === 0 && !input.html) {
    headers.push(
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
    );
    return base64Url(
      `${headers.join("\r\n")}\r\n\r\n${normalizeBody(input.text ?? "")}`,
    );
  }

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const body: string[] = [];
  if (input.html) {
    const alternative = `${boundary}-alternative`;
    body.push(
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${alternative}"`,
      "",
      `--${alternative}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      normalizeBody(input.text ?? stripHtml(input.html)),
      `--${alternative}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      normalizeBody(input.html),
      `--${alternative}--`,
    );
  } else {
    body.push(
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      normalizeBody(input.text ?? ""),
    );
  }

  for (const attachment of attachments) {
    body.push(
      `--${boundary}`,
      `Content-Type: ${safeMimeType(attachment.mimeType)}; name="${quote(attachment.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${quote(attachment.filename)}"`,
      "",
      wrapBase64(attachment.dataBase64),
    );
  }
  body.push(`--${boundary}--`, "");
  return base64Url(`${headers.join("\r\n")}\r\n\r\n${body.join("\r\n")}`);
}

export function decodeBase64Url(value: string): Uint8Array {
  return new Uint8Array(
    Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
  );
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function mailbox(value: Mailbox): string {
  const email = safeHeaderValue(value.email);
  return value.name ? `${encodeHeader(value.name)} <${email}>` : email;
}

function encodeHeader(value: string): string {
  const clean = safeHeaderValue(value);
  return /[^\x20-\x7e]/.test(clean)
    ? `=?UTF-8?B?${Buffer.from(clean).toString("base64")}?=`
    : clean;
}

function safeHeaderName(value: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(value))
    throw new Error("Invalid MIME header name.");
  return value;
}

function safeHeaderValue(value: string): string {
  if (/[\r\n]/.test(value))
    throw new Error("MIME header values cannot contain newlines.");
  return value;
}

function safeMimeType(value: string): string {
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(value))
    throw new Error("Invalid attachment MIME type.");
  return value;
}

function quote(value: string): string {
  return safeHeaderValue(value).replace(/["\\]/g, "_");
}

function normalizeBody(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

function wrapBase64(value: string): string {
  const compact = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact))
    throw new Error("Attachment data is not valid Base64.");
  return compact.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
