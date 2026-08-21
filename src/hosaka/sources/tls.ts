import { connect } from "node:tls";
import type { TlsFacts } from "../types.ts";

/**
 * The certificate, read straight off the TLS handshake.
 *
 * The subject alternative names are the valuable part: a certificate usually
 * lists a company's other hostnames, which is how staging environments, second
 * brands and acquired domains surface without any paid dataset.
 */
export function collectTls(domain: string, timeoutMs = 8000): Promise<TlsFacts> {
  return new Promise((resolve, reject) => {
    const socket = connect(
      { host: domain, port: 443, servername: domain, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate(false);
        socket.destroy();
        if (!cert || Object.keys(cert).length === 0) {
          reject(new Error("no certificate presented"));
          return;
        }
        resolve({
          // Node types these as string | string[]; a multi-valued O is legal.
          issuer: first(cert.issuer?.O) ?? first(cert.issuer?.CN),
          validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
          validTo: cert.valid_to ? new Date(cert.valid_to).toISOString() : null,
          altNames: (cert.subjectaltname ?? "")
            .split(",")
            .map((s) => s.trim().replace(/^DNS:/, ""))
            .filter((s) => s.length > 0),
        });
      },
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error("tls handshake timed out"));
    });
    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
