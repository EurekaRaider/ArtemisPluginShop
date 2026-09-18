import { describe, expect, it } from "vitest";
import {
  CONNECTOR_AUTH_META,
  readConnectorAuth,
} from "../src/shared/connector-auth.js";
describe("private connector authentication", () => {
  it("requires the current context and exact platform", () => {
    const context = {
      version: 1,
      provider: "google",
      connectionId: "gmail",
      accessToken: "private-access-token",
    };
    expect(readConnectorAuth({ [CONNECTOR_AUTH_META]: context })).toEqual(
      context,
    );
    for (const meta of [
      undefined,
      {},
      { "com.artemis.google/access-token": "old-access" },
      { [CONNECTOR_AUTH_META]: { ...context, version: 0 } },
      { [CONNECTOR_AUTH_META]: { ...context, provider: "microsoft" } },
      { [CONNECTOR_AUTH_META]: { ...context, connectionId: "" } },
    ])
      expect(() => readConnectorAuth(meta)).toThrow(/reconnect/);
  });
  it("does not confuse a token with a mailbox authorization code", () => {
    expect(() =>
      readConnectorAuth(
        {
          [CONNECTOR_AUTH_META]: {
            version: 1,
            provider: "qq",
            connectionId: "qq",
            accessToken: "private-access-token",
          },
        },
        "qq",
      ),
    ).toThrow();
    expect(
      readConnectorAuth(
        {
          [CONNECTOR_AUTH_META]: {
            version: 1,
            provider: "qq",
            connectionId: "qq",
            account: "demo@qq.com",
            appPassword: "abcdefghijklmnop",
          },
        },
        "qq",
      ).account,
    ).toBe("demo@qq.com");
  });
});
