import type { ArtemisAuthContext } from "./artemis-auth.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class GoogleApi {
  constructor(
    private readonly auth: ArtemisAuthContext,
    private readonly signal?: AbortSignal,
  ) {}

  async json<T>(
    url: string | URL,
    init: RequestInit = {},
    options: { readOnly?: boolean } = {},
  ): Promise<T> {
    const response = await this.request(url, init, options);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async bytes(
    url: string | URL,
    init: RequestInit = {},
    options: { readOnly?: boolean } = {},
  ): Promise<Uint8Array> {
    const response = await this.request(url, init, options);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async request(
    url: string | URL,
    init: RequestInit,
    options: { readOnly?: boolean },
  ): Promise<Response> {
    const attempts = options.readOnly ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${this.auth.accessToken}`);
      headers.set("Accept", "application/json");
      const response = await fetch(url, {
        ...init,
        headers,
        ...(this.signal ? { signal: this.signal } : {}),
      });
      if (response.ok) return response;

      if (
        options.readOnly &&
        RETRYABLE_STATUS.has(response.status) &&
        attempt + 1 < attempts
      ) {
        await delay(250 * 2 ** attempt, this.signal);
        continue;
      }

      const body = sanitizeGoogleError(await response.text());
      throw new Error(
        `Google API request failed (${response.status}): ${body}`,
      );
    }
    throw new Error(
      "Google API request failed after retrying a read-only operation.",
    );
  }
}

export function googleJsonBody(
  value: unknown,
): Pick<RequestInit, "body" | "headers"> {
  return {
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json; charset=utf-8" },
  };
}

export function withQuery(
  base: string,
  values: Record<string, string | number | boolean | undefined>,
): URL {
  const url = new URL(base);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

export function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function sanitizeGoogleError(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/"access_token"\s*:\s*"[^"]+"/gi, '"access_token":"[REDACTED]"')
    .slice(0, 2_000);
}

async function delay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
