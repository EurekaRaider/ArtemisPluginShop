# Artemis Plugin Shop

Signed connectors for Artemis, using the version 1 connector contract. Users
install a plugin, choose **Connect**, and authorize in the system browser or
follow the short local setup guide. No Artemis backend, Node installation,
Docker or user-created developer project is required.

| Plugin           | Runtime               | Initial functionality                                                       |
| ---------------- | --------------------- | --------------------------------------------------------------------------- |
| Gmail            | Bundled local MCP     | Search/read, attachments, drafts, send, labels, archive, trash/restore      |
| Google Workspace | Bundled local MCP     | Drive, Docs, Sheets, Slides and Calendar read/write                         |
| QQ Mail          | Bundled IMAP/SMTP MCP | Search/read, attachments, drafts, send, read/unread and safe move           |
| GitHub           | Official remote MCP   | Tools provided by the approved GitHub MCP service                           |
| Figma            | Official desktop MCP  | Design context, screenshots and metadata exposed by the running desktop app |
| Notion           | Official remote MCP   | Tools exposed by the admitted official service                              |
| Linear           | Official remote MCP   | Tools exposed by the admitted official service                              |

Remote services are release candidates until publisher/client admission and
controlled-account acceptance are recorded. This repository's local builds do
not establish platform approval. Figma does not fall back to PAT authentication.
QQ and Gmail do not expose permanent deletion. QQ reads messages up to 25 MiB
and sends combined attachments up to 20 MiB. No continuous inbox monitoring is
included.

## Connect

1. Add this signed marketplace or import its offline archive in Artemis.
2. Verify the displayed signing-key fingerprint and install the plugin. Its connection
   dialog opens automatically. Loading the marketplace alone does not authorize anything.
   Later, use Configure on the installed plugin to reconnect or disconnect.
3. Google: finish browser consent. Gmail and Workspace have separate
   permissions for the same Google identity.
4. GitHub: copy the displayed code and confirm on GitHub's device page.
5. QQ: enable IMAP/SMTP in QQ Mail and enter the email and generated authorization
   code in Artemis. The adapter fixes imap.qq.com:993 and smtp.qq.com:465 with TLS.
6. Figma: enable the official desktop MCP server, then detect/connect in Artemis.

Client IDs belong to the publisher's registered applications and are bundled by
Artemis. They are never requested from ordinary users. Dynamic registration is
used only where the platform supports it. See the paired Artemis
[connector publisher guide](https://github.com/williamjinj-eng/Artemis/blob/main/docs/connectors.md).

## New contract only

Each plugin has one `.mcp.json` runtime with one `x-artemis.connector` object:
version, stable id, provider, displayName, auth, scopes, capabilities,
requiredHostCapabilities and setup. The containing MCP
server is the runtime reference. The host checks the version, supported provider,
scopes, official endpoint, pinned signature, exact file digest and config binding.

All existing users must update the host and plugins and reconnect. There is no
compatibility mode or credential migration. Historical files are not read or
removed. The local adapters require a private `ConnectorAuthContext` in the
`com.artemis.connector/auth` metadata key; missing or unsupported context fails
before network access. Refresh tokens never leave the host. Tokens are never
configuration, environment variables, tool parameters, Skills or package assets.

Pi remains the only agent loop. Host approval and sandbox checks apply to tools;
Plan/Review cannot execute them. Cancelled approval must not send a write. An
uncertain send must be checked in the mailbox before an explicit retry.

## Languages

All seven listed plugins include display names and descriptions in the same 14 languages
as Artemis: `en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de`, `pt-BR`, `it`,
`ru`, `ar`, `hi`, and `id`. Detailed descriptions and suggested prompts are also
translated where declared. Product names and connector identifiers stay stable.

The manifest's top-level `localizations` object maps each locale to
`displayName`, `description`, `shortDescription`, and optional `longDescription`
and `defaultPrompt` values. Artemis retains this data through installation and
selects text using its resolved interface language, including Follow System.
Changing the language updates cards, plugin management, search and open connection
dialogs immediately. No separate plugin language setting is needed.

Use an Artemis build with plugin-localization support and update already installed
plugins once to load the new metadata. Older hosts continue to show the base
English text. Missing third-party translations fall back to English and then to
the original manifest fields. Package verification requires complete translations
for this marketplace; the translations are covered by the package signature.

## Build and verify

Node 24 and npm 11+ are development dependencies, not user prerequisites.
`scripts/plugin-builds.mjs` drives all local runtime bundles and startup smoke
checks. The marketplace drives all declaration-only packages. Runtime bundles
execute with `${ARTEMIS_NODE}` and do not install or download dependencies.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run smoke:runtime
npm run sign
npm run verify
npm run package:offline
npm run verify:offline
```

Signing uses the existing private Ed25519 key in `.artemis/signing-key.pem`, or
`ARTEMIS_MARKETPLACE_SIGNING_KEY`. Never include this key in a package. The signed
integrity file binds marketplace identity, source URL, each exact file list and
content digest. Offline installation verifies the same evidence.

Before public release, complete paired host/package tests on macOS arm64, macOS
x64 and Windows; six first-wave service account tests; cancellation, revocation,
refresh concurrency and uncertain-send tests; and remote MCP admission checks.
Google restricted-scope verification must cover the actual model data flow;
a desktop-only transport does not automatically exempt cloud model processing.

Official references: [Google verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification),
[Figma desktop](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/).
