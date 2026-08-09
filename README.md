<div align="center">

<img src="./assets/artemis-plugin-shop-icon.png" width="92" alt="Artemis Plugin Shop brand icon" />

# Artemis Plugin Shop

### Signed Google capabilities for an external Artemis marketplace.

**A manually configured plugin shop for Gmail and Google Workspace, with signed,
self-contained runtimes, Artemis-hosted OAuth and an offline distribution path.**

<p>
  <img alt="External marketplace" src="https://img.shields.io/badge/Marketplace-external-2088FF" />
  <img alt="Version 0.1.1" src="https://img.shields.io/badge/Version-v0.1.1-4C8BF5" />
  <img alt="Ed25519 integrity" src="https://img.shields.io/badge/Integrity-Ed25519-8257E5" />
  <img alt="Manual releases" src="https://img.shields.io/badge/Releases-manual-F5A524" />
  <img alt="Two plugins" src="https://img.shields.io/badge/Plugins-2-2EA44F" />
</p>

<p>
  <img alt="macOS arm64 and x64 target" src="https://img.shields.io/badge/macOS-arm64%20%7C%20x64-111111?logo=apple&logoColor=white" />
  <img alt="Windows x64 target" src="https://img.shields.io/badge/Windows-x64-0078D4?logo=windows&logoColor=white" />
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white" />
  <img alt="Eleven passing tests" src="https://img.shields.io/badge/Tests-11_passing-2EA44F" />
</p>

[Overview](#01--marketplace-overview) · [Install](#02--installation-paths) · [Google account](#03--google-account-and-scopes) · [Plugins](#04--plugin-catalog) · [Trust](#05--trust-and-execution-boundary) · [Development](#06--development-and-manual-release) · [Validation](#07--validation-status)

</div>

---

<p align="center">
  <strong>External</strong>&nbsp;&nbsp;·&nbsp;&nbsp;
  <strong>Signed</strong>&nbsp;&nbsp;·&nbsp;&nbsp;
  <strong>Offline-capable</strong>&nbsp;&nbsp;·&nbsp;&nbsp;
  <strong>Host-authenticated</strong>
</p>

<br />

## 01 / Marketplace overview

### Google tools without bundling the shop into Artemis

Artemis Plugin Shop is an independent marketplace for
[Artemis](https://github.com/williamjinj-eng/Artemis). Artemis does not bundle,
register or preconfigure this repository. Nothing is downloaded or shown until
the user explicitly adds its GitHub address or imports a signed offline package.
Its brand mark keeps the Artemis crescent and adds a small plug in the
lower-right corner to identify an Artemis plugin marketplace.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Explicit distribution</h3>
      <p><strong>Online and offline installation are both initiated by the local user.</strong></p>
      <ul>
        <li>Add the GitHub <code>owner/repository</code> address when the machine is connected.</li>
        <li>Download a signed archive elsewhere and import it into Artemis on an offline machine.</li>
        <li>Startup, browsing, search and installation read the validated Artemis cache.</li>
        <li>Offline sources are updated by importing a newer package, not by silently contacting GitHub.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>Explicit trust</h3>
      <p><strong>Host credentials are available only to content from a confirmed signing key.</strong></p>
      <ul>
        <li><code>.artemis/integrity.json</code> signs the marketplace and every plugin file with Ed25519.</li>
        <li>Artemis displays the repository identity and signing-key fingerprint before trust is recorded.</li>
        <li>Refresh and re-import use atomic cache replacement; failed validation preserves the previous cache.</li>
        <li>Plugins receive short-lived access tokens, never the Google OAuth client secret or refresh token.</li>
      </ul>
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="50%" valign="top">
      <p><strong>01</strong>&nbsp;&nbsp;/&nbsp;&nbsp;GOOGLE WORKSPACE</p>
      <p>Drive, Docs, Sheets, Slides and Calendar through their official Google REST APIs, limited to resources available to the connected Google account.</p>
    </td>
    <td width="50%" valign="top">
      <p><strong>02</strong>&nbsp;&nbsp;/&nbsp;&nbsp;GMAIL</p>
      <p>Search, threads, MIME bodies, attachments, drafts, sending, replies, forwarding, labels, read state, archive, trash and restore through <code>gmail.modify</code>.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <p><strong>03</strong>&nbsp;&nbsp;/&nbsp;&nbsp;SELF-CONTAINED RUNTIME</p>
      <p>Each plugin ships a generated <code>runtime/server.mjs</code>. Artemis runs it through <code>${ARTEMIS_NODE}</code>; installation does not invoke npm or download dependencies.</p>
    </td>
    <td width="50%" valign="top">
      <p><strong>04</strong>&nbsp;&nbsp;/&nbsp;&nbsp;LOCAL CONFIRMATION</p>
      <p>Sending mail, forwarding, trash actions, destructive Drive operations and Calendar changes carry <code>destructiveHint</code> and require a local confirmation summary.</p>
    </td>
  </tr>
</table>

> [!NOTE]
> Slack, WeChat, remote control, permanent Gmail deletion and Google account settings are intentionally outside this release. The implementation is greenfield and does not reuse `GoogleWorkspacePlugin` code or architecture.

<br />

## 02 / Installation paths

### Add the GitHub marketplace

In Artemis, open **Resource Center → Add plugin → Git marketplace** and enter:

```text
williamjinj-eng/ArtemisPluginShop
```

or:

```text
https://github.com/williamjinj-eng/ArtemisPluginShop
```

Confirm the repository and the displayed Ed25519 fingerprint. The current
development key fingerprint is:

```text
cfb9da883241fb32dc7e6bf9ddd6748593edd71809969cb6842fad5644b6b247
```

After the first successful add, startup, browsing and search use the local
cache. **Refresh marketplace** and **Update plugin** are explicit online
operations. A missing or corrupt cache produces an error and waits for the user
to refresh it.

### Import a signed offline package

Manual packaging creates:

```text
dist/ArtemisPluginShop-offline-<version>.tar.gz
dist/ArtemisPluginShop-offline-<version>.tar.gz.sha256
```

Move both files to the target machine and verify them from the directory that
contains the downloads:

```bash
shasum -a 256 -c ArtemisPluginShop-offline-<version>.tar.gz.sha256
```

Open **Resource Center → Add plugin → Offline marketplace package** and select
the `.tar.gz`, `.tgz`, or its extracted directory. Artemis validates the exact
signed file list and copies it atomically into its own cache. It does not retain
a dependency on the selected path and does not access GitHub while importing,
browsing or installing the offline marketplace.

> [!IMPORTANT]
> Re-importing a newer package is the update operation for an offline source. The old cache is replaced only after the new package passes archive, path, size, signature and content-digest validation.

<br />

## 03 / Google account and scopes

### Artemis owns OAuth; plugins use per-call access tokens

The plugins do not read Chrome or Safari cookies. Artemis ships its own Google
Cloud **Desktop app** OAuth client as an application-level build resource.
Users authorize in the system browser; Artemis uses PKCE, random `state`, a
temporary `127.0.0.1` callback and operating-system encrypted token storage.

1. The Artemis publisher enables the required Google APIs and configures the OAuth consent screen.
2. The Artemis release build includes its dedicated Desktop app client outside public Git history.
3. Users authorize Workspace and Gmail separately for the same Google identity.
4. The plugin can use only Drive and Calendar resources available to the connected Google account.

<table>
  <tr>
    <td width="50%" valign="top">
      <p><strong>WORKSPACE GRANT</strong></p>
      <pre><code>openid email profile
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/calendar</code></pre>
      <p>Google applies the connected account's file, folder, Shared Drive and sharing permissions to every Drive API request.</p>
    </td>
    <td width="50%" valign="top">
      <p><strong>GMAIL GRANT</strong></p>
      <pre><code>openid email profile
https://www.googleapis.com/auth/gmail.modify</code></pre>
      <p>The plugin does not request <code>mail.google.com</code> and does not expose permanent deletion, delegation, forwarding rules, filters or account-security settings.</p>
    </td>
  </tr>
</table>

> [!WARNING]
> Full Drive, Calendar and `gmail.modify` access can require Google OAuth verification for public production use. Google permissions still determine which resources the connected account can read or modify.

<br />

## 04 / Plugin catalog

### Google Workspace

<details open>
<summary><strong>Drive, Docs, Sheets, Slides and Calendar</strong></summary>

- **Drive** — search, metadata, upload, download, folder creation, copy, move,
  rename, trash and restore for resources available to the connected account.
- **Docs** — read, create and structured batch updates.
- **Sheets** — read ranges, create spreadsheets, update, append and clear.
- **Slides** — read, create and structured batch updates.
- **Calendar** — list, read, create, update and cancel events on calendars the
  connected account can access.

</details>

### Gmail

<details open>
<summary><strong>Messages, threads, attachments, drafts and labels</strong></summary>

- Search messages, read threads, decode text/HTML MIME bodies and download
  attachments.
- Create, inspect, update, delete and send drafts.
- Send, reply and forward while preserving `threadId`, `References`,
  `In-Reply-To` and the normalized subject.
- Create and delete user labels; mark read/unread; archive; move to trash and
  restore.
- Sending, replying, forwarding, deleting drafts or labels, and moving messages
  to trash require a local confirmation summary.

</details>

<br />

## 05 / Trust and execution boundary

### Signed content, host-owned credentials and bounded retries

| Boundary             | Contract                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Marketplace identity | `.artemis/integrity.json` binds the marketplace name, public GitHub source, key fingerprint, manifest hash and plugin file hashes.                                             |
| Offline archive      | Only the signed manifest, public integrity declaration and exact signed plugin files are accepted. Extra files, links and unsafe paths are rejected.                           |
| Runtime              | `${ARTEMIS_NODE}` resolves to the Artemis Electron executable with `ELECTRON_RUN_AS_NODE=1`; plugin installation runs no package manager.                                      |
| Google credentials   | The application OAuth client ships with Artemis; user refresh tokens stay in `safeStorage`. The MCP receives only a short-lived access token in private `tools/call` metadata. |
| Logging              | Access and refresh tokens must not enter model arguments, application logs or diagnostic archives.                                                                             |
| Retries              | Read-only calls may retry transient `429`/`5xx` responses. Non-idempotent writes are not automatically retried.                                                                |
| Lifecycle            | Newly installed Google plugins remain disabled until their grant is complete. Revoked grants or added scopes require authorization again.                                      |

Removing a marketplace removes its source record and cache but does not
automatically uninstall installed plugins. Removing one Google plugin deletes
only that plugin's grant and runtime configuration; disconnecting the shared
Google account revokes and removes all Google credentials.

<br />

## 06 / Development and manual release

### Repository layout

```text
.agents/plugins/marketplace.json       marketplace catalog
.artemis/integrity.json                public signed integrity declaration
assets/artemis-plugin-shop-icon.png    Artemis plugin-marketplace brand mark
plugins/google-workspace/              installable Workspace plugin
plugins/gmail/                         installable Gmail plugin
src/                                   greenfield TypeScript implementation
scripts/                               build, sign, verify and package tools
test/                                  API access and security tests
dist/                                  ignored manual offline-package output
```

### Requirements and checks

> [!IMPORTANT]
> **Runtime baseline** — Node.js 24+ · npm 11+ · target Artemis build with signed external/offline marketplace and Google host-auth support

```bash
npm install
npm run check
```

`npm run build` regenerates both self-contained MCP runtimes. The checked-in SVG
and PNG brand assets are included unchanged. After changing any marketplace or
plugin file, sign the exact output with a securely stored Ed25519 key:

```bash
ARTEMIS_MARKETPLACE_SIGNING_KEY=/secure/path/ed25519-private-key.pem npm run sign
npm run verify
```

For initial development only, `npm run sign -- --generate-key` creates
`.artemis/signing-key.pem` with mode `0600`. The private key and generated
`dist/` directory are gitignored and must not be committed.

### Manual offline package

```bash
npm run package:offline
npm run verify:offline
```

Upload the generated archive and `.sha256` sidecar to a GitHub Release manually
when ready. This repository intentionally has no enabled CI/CD or Release
workflow.

<br />

## 07 / Validation status

### Verified in the current workspace

- TypeScript type checking, deterministic builds and formatting pass.
- Five test files with eleven tests pass.
- Both plugin manifests pass the plugin validator.
- Ed25519 signatures, manifest digest and exact plugin file lists pass.
- The offline archive contains only fourteen signed public files and its
  SHA-256 sidecar verifies.
- Gmail and Workspace MCP initialization and `tools/list` pass through the
  actual Artemis arm64 Electron executable in Node mode on macOS arm64.

### Remaining release acceptance

- Real Google OAuth and API operations with a controlled test account.
- Packaged Artemis browser authorization and plugin lifecycle on macOS arm64 and x64.
- Native Windows x64 package, authorization and API acceptance.
- Google production OAuth verification, Developer ID signing and notarization
  where required by the intended distribution model.

> [!NOTE]
> A successful build, signature check or MCP startup does not establish end-to-end Google API acceptance or production distribution readiness.

---

<p align="center">
  <sub>Artemis Plugin Shop · external by configuration · offline by package · trusted by signature</sub>
</p>
