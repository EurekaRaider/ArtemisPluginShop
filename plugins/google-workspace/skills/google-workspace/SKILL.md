---
name: google-workspace
description: Use direct Google Drive, Docs, Sheets, Slides, and Calendar tools for resources available to the single Google account connected in Artemis.
---

# Google Workspace

Use this Skill when the user asks to inspect or change Google Drive, Docs,
Sheets, Slides, or Calendar data.

## Safety

- Treat Google's file, folder, Shared Drive, and calendar permissions as hard
  limits. Never suggest bypassing them or using another identity.
- Read the current resource before a destructive edit so the confirmation
  summary is specific.
- Prefer reversible operations. Use trash rather than permanent deletion; this
  plugin does not provide permanent deletion.
- Never claim that the OAuth grant itself is folder-scoped. Artemis requests
  Drive and Calendar scopes; Google still enforces the connected account's
  permissions for each resource.
- Do not automatically retry non-idempotent writes.

## Workflow

1. Use `google_workspace_status` when the connection state is unclear.
2. Locate the exact file, folder, document, range, presentation, or event.
3. Read its current state before editing.
4. Explain material changes before calling a destructive tool.
5. Report the returned resource ID and link after a successful change.

Use Configure on this installed plugin to connect or reconnect; first installation opens its connection dialog automatically. Never ask users for Client IDs, developer projects, tokens or authorization codes in conversation. Historical plugin authorization is unsupported; install the paired version and reconnect.
