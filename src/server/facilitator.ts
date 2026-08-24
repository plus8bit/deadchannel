/**
 * HTTP client for the x402 facilitator interface (spec section 7).
 *
 * The facilitator is what lets this service sell without ever holding a private
 * key: it validates the buyer's signed authorization and broadcasts settlement
 * on our behalf. We only ever declare where the money should go.
 */

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  transaction: string;
  network?: string;
  payer?: string;
  amount?: string;
}

export interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

export class FacilitatorError extends Error {
  readonly status: number | null;
  readonly body: string | null;

  constructor(message: string, status: number | null, body: string | null) {
    super(message);
    this.name = "FacilitatorError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Produces an Authorization header value for one request, or null when the
 * facilitator needs no auth. Per-request because CDP binds its token to the
 * method and path being called.
 */
/**
 * How to authenticate one request.
 *
 * A string becomes an Authorization header, which is what Coinbase and the
 * keyless facilitators want. A record is sent as-is, because not every
 * facilitator uses that header: Solvador reads X-API-Key, and sending its key
 * as a bearer token authenticates nothing.
 */
export type AuthProvider = (method: string, url: string) => string | Record<string, string> | null;

export function staticToken(token: string | null): AuthProvider {
  return () => (token ? `Bearer ${token}` : null);
}

export class FacilitatorClient {
  readonly baseUrl: string;
  readonly #auth: AuthProvider;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, auth: AuthProvider | string | null = null, timeoutMs = 20_000) {
    this.baseUrl = baseUrl;
    this.#auth = typeof auth === "function" ? auth : staticToken(auth);
    this.#timeoutMs = timeoutMs;
  }

  /** Read-only validation. Must run before the resource executes. */
  verify(paymentPayload: unknown, paymentRequirements: unknown): Promise<VerifyResponse> {
    return this.post<VerifyResponse>("/verify", {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
    });
  }

  /** Commits the payment. Runs after the resource produced a successful result. */
  settle(paymentPayload: unknown, paymentRequirements: unknown): Promise<SettleResponse> {
    return this.post<SettleResponse>("/settle", {
      x402Version: 2,
      paymentPayload,
      paymentRequirements,
    });
  }

  /** Used at boot to prove the facilitator can actually settle on our network. */
  async supported(): Promise<SupportedKind[]> {
    const body = await this.get<{ kinds?: SupportedKind[] }>("/supported");
    return body.kinds ?? [];
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body: JSON.stringify(body) });
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  /**
   * The headers this client would send. Exposed so a deployment can prove its
   * credentials resolve before it starts taking payments, rather than finding
   * out at settlement with a signed authorization already in hand.
   */
  authFor(method: string, url: string) {
    return this.#auth(method, url);
  }

  private async request<T>(path: string, init: { method: string; body?: string }): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const url = `${this.baseUrl}${path}`;
    const authorization = this.#auth(init.method, url);

    try {
      const res = await fetch(url, {
        method: init.method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(typeof authorization === "string"
            ? { authorization }
            : (authorization ?? {})),
        },
        ...(init.body ? { body: init.body } : {}),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new FacilitatorError(
          `facilitator ${init.method} ${path} returned ${res.status}`,
          res.status,
          text.slice(0, 500),
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new FacilitatorError(`facilitator ${path} returned non-JSON`, res.status, text.slice(0, 200));
      }
    } catch (err) {
      if (err instanceof FacilitatorError) throw err;
      const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : String(err);
      throw new FacilitatorError(`facilitator ${init.method} ${path} failed: ${reason}`, null, null);
    } finally {
      clearTimeout(timer);
    }
  }
}
