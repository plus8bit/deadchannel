import { parsePaymentRequirements } from "./parse.ts";
import type { PaymentRequirements } from "./types.ts";

/** One HTTP round trip against the target, plus everything we learned from it. */
export interface Observation {
  /** True when we got an HTTP response at all — a 402 or a 500 both count. */
  responded: boolean;
  status: number | null;
  error: string | null;
  ms: number;
  bodyText: string | null;
  bodyBytes: number;
  contentType: string | null;
  serverHeader: string | null;
  /** Present only when the body parsed as x402 payment requirements. */
  requirements: PaymentRequirements | null;
  userAgent: string;
}

/** Agents identify themselves as non-browsers. This is the UA an indexer would send. */
export const AGENT_UA = "deadchannel-probe/0.1 (+https://github.com/deadchannel)";
/** A browser UA, used only to detect bot gating that hides an endpoint from indexers. */
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Bodies above this are truncated — we only need the head to classify a response. */
const MAX_BODY_BYTES = 64 * 1024;

export async function observe(
  url: string,
  opts: { timeoutMs: number; userAgent: string },
): Promise<Observation> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/json, */*",
        "user-agent": opts.userAgent,
      },
    });

    const bodyText = await readCapped(res);
    const ms = performance.now() - started;

    // x402 v2 moved payment data into a base64 header and leaves the body empty,
    // so the header is checked first; v1 servers only ever populate the body.
    let requirements = requirementsFromHeaders(res.headers);
    if (requirements === null && bodyText !== null) {
      try {
        requirements = parsePaymentRequirements(JSON.parse(bodyText));
      } catch {
        // Not JSON, or not x402-shaped. Both are findings, not errors.
      }
    }

    return {
      responded: true,
      status: res.status,
      error: null,
      ms,
      bodyText,
      bodyBytes: bodyText === null ? 0 : Buffer.byteLength(bodyText),
      contentType: res.headers.get("content-type"),
      serverHeader: res.headers.get("server"),
      requirements,
      userAgent: opts.userAgent,
    };
  } catch (err) {
    return {
      responded: false,
      status: null,
      error: describeError(err),
      ms: performance.now() - started,
      bodyText: null,
      bodyBytes: 0,
      contentType: null,
      serverHeader: null,
      requirements: null,
      userAgent: opts.userAgent,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Header names that have carried v2 payment requirements in the wild. */
const REQUIREMENT_HEADERS = ["payment-required", "x-payment-required", "x402-payment-required"];

function requirementsFromHeaders(headers: Headers): PaymentRequirements | null {
  for (const name of REQUIREMENT_HEADERS) {
    const raw = headers.get(name);
    if (!raw) continue;
    const decoded = decodeMaybeBase64(raw);
    if (decoded === null) continue;
    try {
      const parsed = parsePaymentRequirements(JSON.parse(decoded));
      if (parsed) return parsed;
    } catch {
      // Header present but unparseable — fall through to the next candidate.
    }
  }
  return null;
}

/** The header is base64 by spec, but some servers send raw JSON. Accept both. */
function decodeMaybeBase64(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) return trimmed;
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    return decoded.trimStart().startsWith("{") ? decoded : null;
  } catch {
    return null;
  }
}

async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } catch {
    // Truncated read still gives us a usable head.
  } finally {
    void reader.cancel().catch(() => {});
  }
  if (chunks.length === 0) return "";
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") return "timed out";
    const cause = (err as { cause?: { code?: string } }).cause;
    if (cause?.code) return `${err.message} (${cause.code})`;
    return err.message;
  }
  return String(err);
}
