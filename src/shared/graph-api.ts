import type { ConnectorAuthContext } from "./connector-auth.js";

export class GraphApi {
  constructor(
    private readonly auth: ConnectorAuthContext,
    private readonly signal: AbortSignal,
  ) {}
  async request(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<Record<string, any>> {
    if (!path.startsWith("/me/") || path.includes("#"))
      throw new Error("Unsupported Graph resource.");
    this.signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        method,
        redirect: "error",
        signal: this.signal,
        headers: {
          Authorization: `Bearer ${this.auth.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          Prefer: 'outlook.body-content-type="text"',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error(
        method === "GET"
          ? "Graph connection failed."
          : "Operation outcome is unknown. Verify mailbox state before retrying; do not automatically resend.",
      );
    }
    if (!response.ok)
      throw new Error(
        `Graph request failed (${response.status}).${response.status === 401 ? " Reconnect Outlook." : ""}`,
      );
    if (response.status === 202 || response.status === 204)
      return { accepted: true };
    const result = await response.json();
    // Never accept a caller-supplied nextLink URL, which could carry tokens to another origin.
    const next = result["@odata.nextLink"];
    if (typeof next === "string") {
      const url = new URL(next);
      if (url.origin === "https://graph.microsoft.com")
        result.nextSkip = url.searchParams.get("$skip");
      delete result["@odata.nextLink"];
    }
    return result;
  }
}
