import { describe, expect, it } from "vitest";

import { buildRawMime } from "../src/shared/gmail-mime.js";

describe("Gmail MIME", () => {
  it("preserves reply threading headers and UTF-8 subjects", () => {
    const raw = buildRawMime({
      to: [{ email: "recipient@example.com" }],
      subject: "回复：季度报告",
      text: "收到",
      headers: {
        "In-Reply-To": "<original@example.com>",
        References: "<older@example.com> <original@example.com>",
      },
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("In-Reply-To: <original@example.com>");
    expect(decoded).toContain(
      "References: <older@example.com> <original@example.com>",
    );
    expect(decoded).toContain("Subject: =?UTF-8?B?");
  });

  it("rejects header injection", () => {
    expect(() =>
      buildRawMime({
        to: [{ email: "victim@example.com\r\nBcc: attacker@example.com" }],
        subject: "test",
        text: "test",
      }),
    ).toThrow(/newlines/);
  });
});
