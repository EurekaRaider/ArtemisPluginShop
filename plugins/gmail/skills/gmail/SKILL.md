---
name: gmail
description: Use direct Gmail tools for the single Google account connected in Artemis, including reading, drafts, sending, labels, archive, trash, and restore.
---

# Gmail

Use this Skill when the user asks to work with Gmail messages, threads, drafts,
attachments, or labels.

## Boundaries

- Search and read the exact thread before drafting a reply or forward.
- Preserve Gmail threading with `threadId`, `References`, `In-Reply-To`, and a
  matching subject.
- Sending, replying, forwarding, deleting drafts or labels, and moving mail to
  trash require an Artemis confirmation.
- Prefer trash to deletion. This plugin intentionally has no permanent-delete,
  delegation, forwarding-rule, filter, or account-security tools.
- Do not automatically retry a send or another non-idempotent write.

## Workflow

1. Use `gmail_status` if account authorization is unclear.
2. Search for and read the target thread.
3. Create a draft before sending unless the user explicitly requested an
   immediate send.
4. Verify To, Cc, Bcc, subject, attachments, and reply threading.
5. Summarize the exact outbound message before calling a send tool.
