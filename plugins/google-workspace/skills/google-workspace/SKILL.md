---
name: google-workspace
description: Use direct Google Drive, Docs, Sheets, Slides, and Calendar tools for the single Google account connected in Artemis. Use only approved Drive roots and calendars.
---

# Google Workspace

Use this Skill when the user asks to inspect or change Google Drive, Docs,
Sheets, Slides, or Calendar data.

## Boundaries

- Treat the configured Drive roots and calendars as hard limits. Never suggest
  bypassing them or substituting a raw Google API request.
- Read the current resource before a destructive edit so the confirmation
  summary is specific.
- Prefer reversible operations. Use trash rather than permanent deletion; this
  plugin does not provide permanent deletion.
- Never claim that the OAuth grant itself is folder-scoped. Artemis requests a
  full Drive scope and the plugin enforces the configured root allowlist.
- Do not automatically retry non-idempotent writes.

## Workflow

1. Use `gworkspace_status` when connection or allowed-root state is unclear.
2. Locate the exact file, folder, document, range, presentation, or event.
3. Read its current state before editing.
4. Explain material changes before calling a destructive tool.
5. Report the returned resource ID and link after a successful change.
