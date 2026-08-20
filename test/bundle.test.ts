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
describe("committed serverless bundle", () => {
  it("matches a fresh build of the entry point", () => {
    const out = join(tmpdir(), `deadchannel-bundle-check-${process.pid}.mjs`);
    try {
      execFileSync(
        "npx",
        [
          "esbuild",
          "src/server/vercel-entry.ts",
          "--bundle",
          "--platform=node",
          "--target=node22",
          "--format=esm",
          `--outfile=${out}`,
          "--log-level=error",
        ],
        { stdio: "pipe" },
      );
      assert.equal(
        readFileSync(out, "utf8"),
        readFileSync(new URL("../api/index.mjs", import.meta.url), "utf8"),
        "api/index.mjs is stale — run `npm run build:fn` and commit it",
      );
    } finally {
      rmSync(out, { force: true });
    }
  });
});
