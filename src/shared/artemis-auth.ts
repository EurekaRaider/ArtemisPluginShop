export const ARTEMIS_ACCESS_TOKEN_META = "com.artemis.google/access-token";
export const ARTEMIS_ACCOUNT_EMAIL_META = "com.artemis.google/account-email";
export const ARTEMIS_GOOGLE_CONFIG_META = "com.artemis.google/config";

export interface ArtemisGoogleConfig {
  driveRootIds?: string[];
  calendarIds?: string[];
}

export interface ArtemisAuthContext {
  accessToken: string;
  accountEmail?: string;
  config: ArtemisGoogleConfig;
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
  const rawConfig = meta?.[ARTEMIS_GOOGLE_CONFIG_META];
  const config = isRecord(rawConfig) ? rawConfig : {};

  return {
    accessToken,
    accountEmail: typeof accountEmail === "string" ? accountEmail : undefined,
    config: {
      driveRootIds: stringArray(config.driveRootIds),
      calendarIds: stringArray(config.calendarIds),
    },
  };
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return result.length > 0 ? [...new Set(result)] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
