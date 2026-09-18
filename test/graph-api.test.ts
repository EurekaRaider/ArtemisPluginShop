import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphApi } from "../src/shared/graph-api.js";
afterEach(() => vi.unstubAllGlobals());
const auth = {
  version: 1 as const,
  provider: "microsoft",
  connectionId: "outlook",
  accessToken: "private-token",
};
describe("Graph transport", () => {
  it("pins credential-bearing requests to Graph and refuses redirects", async () => {
    const mock = vi.fn().mockResolvedValue(
      Response.json({
        value: [],
        "@odata.nextLink": "https://evil.example/?token=secret",
      }),
    );
    vi.stubGlobal("fetch", mock);
    const api = new GraphApi(auth, new AbortController().signal);
    expect(await api.request("/me/messages")).toEqual({ value: [] });
    expect(mock.mock.calls[0]?.[0]).toBe(
      "https://graph.microsoft.com/v1.0/me/messages",
    );
    expect(mock.mock.calls[0]?.[1].redirect).toBe("error");
    await expect(api.request("https://evil.example")).rejects.toThrow();
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("never retries an uncertain send or leaks provider diagnostics", async () => {
    const mock = vi.fn().mockRejectedValue(new Error("private-token"));
    vi.stubGlobal("fetch", mock);
    await expect(
      new GraphApi(auth, new AbortController().signal).request(
        "/me/sendMail",
        "POST",
        {},
      ),
    ).rejects.toThrow(/outcome is unknown/);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
