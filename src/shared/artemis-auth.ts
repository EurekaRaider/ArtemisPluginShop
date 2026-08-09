export const ARTEMIS_ACCESS_TOKEN_META = "com.artemis.google/access-token";
export const ARTEMIS_ACCOUNT_EMAIL_META = "com.artemis.google/account-email";

export interface ArtemisAuthContext {
  accessToken: string;
  accountEmail?: string;
}

export function readArtemisAuth(
  meta: Record<string, unknown> | undefined,
): ArtemisAuthContext {
  const accessToken = meta?.[ARTEMIS_ACCESS_TOKEN_META];
  if (typeof accessToken !== "string" || accessToken.length < 20) {
    throw new Error(
      "Artemis did not provide a Google access token for this call.",
    );
  }

  const accountEmail = meta?.[ARTEMIS_ACCOUNT_EMAIL_META];

  return {
    accessToken,
    accountEmail: typeof accountEmail === "string" ? accountEmail : undefined,
  };
}
