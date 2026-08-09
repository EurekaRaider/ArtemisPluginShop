# Google Cloud setup for Artemis

Use a Google Cloud project owned by the Artemis user or organization. The OAuth client belongs to the user; this repository does not ship a client ID or secret.

## APIs

Enable only the APIs needed by installed plugins:

- Google Drive API v3
- Google Docs API v1
- Google Sheets API v4
- Google Slides API v1
- Google Calendar API v3
- Gmail API v1

Create an OAuth 2.0 client ID with application type **Desktop app** and download its JSON file. Artemis accepts the installed-app JSON shape and rejects web-client redirect configurations.

## Consent and grants

Artemis runs one system-browser flow per plugin grant, using PKCE, a cryptographically random `state`, a temporary loopback listener on `127.0.0.1`, `access_type=offline`, and an account `login_hint` after the first connection. It validates the returned OpenID Connect `sub`; a different Google identity is rejected.

Workspace and Gmail grants intentionally use separate refresh tokens. If a plugin update adds scopes, Artemis leaves it installed but disabled until that grant is authorized again.

## Test acceptance

Use non-production test data and verify:

- the system browser returns to Artemis without exposing authorization codes in logs;
- cancelling or changing `state` causes no token exchange;
- choosing a second Google account is rejected;
- Drive items, shortcuts, and Shared Drive items outside enabled roots are rejected;
- only the primary calendar is available until another calendar is enabled;
- cancelling a destructive confirmation produces no Google API call;
- Gmail reply headers retain the thread and no permanent-delete capability exists;
- disconnecting one plugin retains the other grant and shared identity;
- **Disconnect Google account** revokes Google authorization and removes all local secrets.
