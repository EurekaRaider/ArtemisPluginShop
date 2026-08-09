import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleApi } from "../src/shared/google-api.js";

afterEach(() => vi.unstubAllGlobals());

describe("Google API transport", () => {
  it("retries retryable read failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new GoogleApi({
      accessToken: "access-token-long-enough-for-test",
    });
    await expect(
      api.json("https://example.invalid", {}, { readOnly: true }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-idempotent write", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = new GoogleApi({
      accessToken: "access-token-long-enough-for-test",
    });
    await expect(
      api.json("https://example.invalid", { method: "POST" }),
    ).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
