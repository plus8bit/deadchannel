import { probe } from "../probe/probe.ts";
import type { ProbeResult } from "../probe/types.ts";
import type { PaidRoute } from "./x402.ts";

/** The paid resource, described once and reused for serving and for discovery. */
export const PROBE_ROUTE: PaidRoute = {
  path: "/probe",
  method: "POST",
  serviceName: "deadchannel",
  description:
    "Use before paying an x402 endpoint you have not used before, when you cannot tell a working " +
    "seller from a trap, a testnet address dressed as mainnet, or a listing whose price no longer " +
    "matches its challenge. Returns a verdict — live, degraded, trap, testnet or dead — a 0-100 risk " +
    "score, and the specific findings behind both, so an agent can decline a bad endpoint instead of " +
    "learning about it by losing the money. Costs less than the smallest payment it protects.",
  tags: ["preflight", "payment-guard", "x402", "risk", "agent-safety"],
  mimeType: "application/json",
  inputExample: { url: "https://api.example.com/paid-endpoint" },
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The x402 resource URL to check" },
      method: { type: "string", description: "HTTP verb the resource expects, if known" },
      samples: { type: "number", description: "Probes to take, 1-5 (default 2)" },
    },
    required: ["url"],
  },
  outputExample: {
    url: "https://api.example.com/paid-endpoint",
    verdict: "degraded",
    risk: 25,
    priceUsd: 0.01,
    latencyMs: { p50: 180, p99: 240 },
    problems: [
      { id: "schema-advertised", status: "warn", detail: "No input or output schema." },
    ],
  },
};

export interface ProbeRequest {
  url: string;
  method?: string;
  samples?: number;
}

export class BadRequest extends Error {}

const MAX_SAMPLES = 5;
const DEFAULT_SAMPLES = 2;

export function parseProbeRequest(body: unknown): ProbeRequest {
  if (typeof body !== "object" || body === null) {
    throw new BadRequest("body must be a JSON object");
  }
  const raw = body as Record<string, unknown>;

  const url = raw["url"];
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new BadRequest("`url` is required and must be a non-empty string");
  }

  // Reject a foreign scheme outright. Prepending https:// to "file:///etc/passwd"
  // would silently rewrite it into a different, valid-looking URL.
  const trimmed = url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== "http" && scheme !== "https") {
    throw new BadRequest(`\`url\` must be http or https, got "${scheme}:"`);
  }

  let parsed: URL;
  try {
    parsed = new URL(scheme ? trimmed : `https://${trimmed}`);
  } catch {
    throw new BadRequest(`\`url\` is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequest("`url` must be http or https");
  }
  if (!parsed.hostname.includes(".")) {
    throw new BadRequest(`\`url\` must name a public host, got "${parsed.hostname}"`);
  }
  if (isPrivateHost(parsed.hostname)) {
    // Refusing private targets keeps this from being used as an SSRF relay.
    throw new BadRequest("`url` must be a public host");
  }

  const method = raw["method"];
  if (method !== undefined && (typeof method !== "string" || !/^[A-Za-z]{3,7}$/.test(method))) {
    throw new BadRequest("`method` must be an HTTP verb");
  }

  const samples = raw["samples"];
  if (samples !== undefined && (typeof samples !== "number" || !Number.isInteger(samples) || samples < 1 || samples > MAX_SAMPLES)) {
    throw new BadRequest(`\`samples\` must be an integer from 1 to ${MAX_SAMPLES}`);
  }

  return {
    url: parsed.toString(),
    ...(typeof method === "string" ? { method: method.toUpperCase() } : {}),
    ...(typeof samples === "number" ? { samples } : {}),
  };
}

/** Blocks loopback, link-local and RFC1918 targets. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return true;
    }
  }
  return false;
}

export interface ProbeResponse {
  url: string;
  verdict: string;
  risk: number;
  priceUsd: number | null;
  networks: string[];
  latencyMs: { p50: number; p99: number } | null;
  problems: { id: string; status: string; detail: string }[];
  checksPassed: number;
  checksRun: number;
  probedAt: string;
}

export async function runProbe(req: ProbeRequest): Promise<ProbeResponse> {
  // Budgeted for a serverless 30s ceiling: method resolution costs one extra
  // round trip, so worst case is (samples + 1) * timeoutMs plus spacing.
  const result = await probe(req.url, {
    samples: req.samples ?? DEFAULT_SAMPLES,
    timeoutMs: 6000,
    spacingMs: 150,
    ...(req.method ? { method: req.method } : {}),
  });
  return shape(result);
}

function shape(r: ProbeResult): ProbeResponse {
  const problems = r.signals
    .filter((s) => s.status === "fail" || s.status === "warn")
    .sort((a, b) => b.weight - a.weight)
    .map((s) => ({ id: s.id, status: s.status, detail: s.detail }));

  return {
    url: r.url,
    verdict: r.verdict,
    risk: r.risk,
    priceUsd: r.priceUsd,
    networks: [...new Set((r.requirements?.accepts ?? []).map((o) => o.network))],
    latencyMs: r.latency ? { p50: r.latency.p50, p99: r.latency.p99 } : null,
    problems,
    checksPassed: r.signals.filter((s) => s.status === "pass").length,
    checksRun: r.signals.length,
    probedAt: r.probedAt,
  };
}
