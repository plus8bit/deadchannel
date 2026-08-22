import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * The serverless bundle is committed because Vercel validates the `functions`
 * glob before it runs the build, so a file generated during the build arrives
 * too late. A committed artifact can go stale, which would deploy code nobody
 * reviewed, so this rebuilds it and compares.
 *
 * If this fails, run `npm run build:fn` and commit the result.
 */
/** Every shop that ships a committed bundle, and how to rebuild it. */
const BUNDLES: { name: string; entry: string; committed: string; script: string; external?: boolean }[] = [
  { name: "deadchannel", entry: "src/server/vercel-entry.ts", committed: "../api/index.mjs", script: "build:fn" },
  { name: "hosaka", entry: "src/hosaka/server/vercel-entry.ts", committed: "../hosaka/api/index.mjs", script: "build:hosaka" },
  // Published to npm, where a stale build is downloaded by strangers.
  { name: "hosaka-mcp", entry: "src/hosaka/mcp/server.ts", committed: "../packages/hosaka-mcp/src/server.mjs", script: "build:mcp", external: true },
];

describe("committed serverless bundles", () => {
  for (const bundle of BUNDLES) {
    it(`${bundle.name} matches a fresh build of its entry point`, () => {
      const out = join(tmpdir(), `${bundle.name}-bundle-check-${process.pid}.mjs`);
      try {
        execFileSync(
          "npx",
          [
            "esbuild",
            bundle.entry,
            "--bundle",
            "--platform=node",
            "--target=node22",
            "--format=esm",
            ...(bundle.external ? ["--packages=external"] : []),
            `--outfile=${out}`,
            "--log-level=error",
          ],
          { stdio: "pipe" },
        );
        assert.equal(
          readFileSync(out, "utf8"),
          readFileSync(new URL(bundle.committed, import.meta.url), "utf8"),
          `${bundle.committed} is stale — run \`npm run ${bundle.script}\` and commit it`,
        );
      } finally {
        rmSync(out, { force: true });
      }
    });
  }
});
