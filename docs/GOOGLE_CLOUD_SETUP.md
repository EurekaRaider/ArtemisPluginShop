# Google Cloud setup for Artemis

Use a dedicated Google Cloud project owned by the Artemis organization. The Desktop OAuth client belongs to Artemis and is injected into release builds outside public Git history; end users do not import a client JSON.

## APIs

Enable only the APIs needed by installed plugins:

- Google Drive API v3
- Google Docs API v1
- Google Sheets API v4
- Google Slides API v1
- Google Calendar API v3
- Gmail API v1

Create an OAuth 2.0 client ID with application type **Desktop app** and download its JSON file. Place it at `apps/desktop/resources/google-oauth-client.json` only in the private build workspace. The path is Git-ignored and Electron copies it into packaged resources.

## Consent and grants

Artemis runs one system-browser flow per plugin grant, using PKCE, a cryptographically random `state`, a temporary loopback listener on `127.0.0.1`, `access_type=offline`, and an account `login_hint` after the first connection. It validates the returned OpenID Connect `sub`; a different Google identity is rejected.

Workspace and Gmail grants intentionally use separate refresh tokens. If a plugin update adds scopes, Artemis leaves it installed but disabled until that grant is authorized again.

## Test acceptance

Use non-production test data and verify:

- the system browser returns to Artemis without exposing authorization codes in logs;
- cancelling or changing `state` causes no token exchange;
- choosing a second Google account is rejected;
- Drive items unavailable to the connected account are rejected by Google;
- Calendar operations are limited to calendars the connected account can access;
- cancelling a destructive confirmation produces no Google API call;
- Gmail reply headers retain the thread and no permanent-delete capability exists;
- disconnecting one plugin retains the other grant and shared identity;
- **Disconnect Google account** revokes Google authorization and removes all local secrets.
