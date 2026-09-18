export const CONNECTOR_AUTH_META = "com.artemis.connector/auth";
export interface ConnectorAuthContext {
  version: 1;
  provider: string;
  connectionId: string;
  account?: string;
  accessToken?: string;
  appPassword?: string;
}
type MailAuth = ConnectorAuthContext & {
  provider: "qq";
  account: string;
  appPassword: string;
};
type TokenAuth = ConnectorAuthContext & { accessToken: string };
export function readConnectorAuth(
  meta: Record<string, unknown> | undefined,
  provider: "qq",
): MailAuth;
export function readConnectorAuth(
  meta: Record<string, unknown> | undefined,
  provider?: "google" | "microsoft",
): TokenAuth;
export function readConnectorAuth(
  meta: Record<string, unknown> | undefined,
  provider = "google",
): ConnectorAuthContext {
  const value = meta?.[CONNECTOR_AUTH_META] as ConnectorAuthContext | undefined;
  if (
    !value ||
    value.version !== 1 ||
    value.provider !== provider ||
    typeof value.connectionId !== "string" ||
    !value.connectionId ||
    (provider === "qq"
      ? typeof value.appPassword !== "string" ||
        !/^[a-z]{16}$/i.test(value.appPassword) ||
        typeof value.account !== "string" ||
        !/^[^\s@]+@(qq\.com|foxmail\.com)$/i.test(value.account)
      : typeof value.accessToken !== "string" || value.accessToken.length < 10)
  )
    throw new Error(
      "A valid Artemis connector authorization context is required. Update the plugin and reconnect.",
    );
  return value;
}
