import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtemisAuthContext } from "../src/shared/artemis-auth.js";
import { DriveBoundary } from "../src/shared/drive-boundary.js";
import { GoogleApi } from "../src/shared/google-api.js";

const auth: ArtemisAuthContext = {
  accessToken: "test-access-token-with-enough-length",
  config: { driveRootIds: ["allowed-root"] },
};

afterEach(() => vi.unstubAllGlobals());

describe("Drive boundary", () => {
  it("walks the current parent chain to an enabled root", async () => {
    const files = new Map([
      ["child", { id: "child", parents: ["folder"] }],
      [
        "folder",
        {
          id: "folder",
          parents: ["allowed-root"],
          mimeType: "application/vnd.google-apps.folder",
        },
      ],
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const id = decodeURIComponent(
          new URL(String(input)).pathname.split("/").at(-1)!,
        );
        return Response.json(files.get(id));
      }),
    );

    const boundary = new DriveBoundary(new GoogleApi(auth), auth);
    await expect(boundary.assertAllowed("child")).resolves.toMatchObject({
      id: "child",
    });
  });

  it("rejects a shortcut whose target is outside the enabled roots", async () => {
    const files = new Map([
      [
        "shortcut",
        {
          id: "shortcut",
          parents: ["allowed-root"],
          shortcutDetails: { targetId: "outside" },
        },
      ],
      ["outside", { id: "outside", parents: ["other-root"] }],
      ["other-root", { id: "other-root", parents: [] }],
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const id = decodeURIComponent(
          new URL(String(input)).pathname.split("/").at(-1)!,
        );
        return Response.json(files.get(id));
      }),
    );

    const boundary = new DriveBoundary(new GoogleApi(auth), auth);
    await expect(boundary.assertAllowed("shortcut")).rejects.toThrow(
      /outside the Artemis folder allowlist/,
    );
  });

  it("requires at least one configured root", () => {
    expect(
      () =>
        new DriveBoundary(new GoogleApi({ ...auth, config: {} }), {
          ...auth,
          config: {},
        }),
    ).toThrow(/No Drive root folders/);
  });
});
