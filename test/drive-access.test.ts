import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArtemisAuthContext } from "../src/shared/artemis-auth.js";
import { DriveAccess } from "../src/shared/drive-access.js";
import { GoogleApi } from "../src/shared/google-api.js";

const auth: ArtemisAuthContext = {
  accessToken: "test-access-token-with-enough-length",
};

afterEach(() => vi.unstubAllGlobals());

describe("Drive access", () => {
  it("accepts any Drive item returned for the connected Google account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ id: "shared-file", parents: ["shared-folder"] }),
      ),
    );

    const access = new DriveAccess(new GoogleApi(auth));
    await expect(access.assertAccessible("shared-file")).resolves.toMatchObject(
      {
        id: "shared-file",
      },
    );
  });

  it("delegates inaccessible items to Google's permission response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { message: "File not found" } },
          { status: 404 },
        ),
      ),
    );

    const access = new DriveAccess(new GoogleApi(auth));
    await expect(access.assertAccessible("not-accessible")).rejects.toThrow(
      /Google API request failed \(404\)/,
    );
  });

  it("still verifies that upload destinations are folders", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ id: "document", mimeType: "text/plain" }),
      ),
    );

    const access = new DriveAccess(new GoogleApi(auth));
    await expect(access.assertAccessibleFolder("document")).rejects.toThrow(
      /is not a folder/,
    );
  });
});
