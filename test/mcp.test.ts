import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { McpServer, failure, text } from "../src/mcp/protocol.ts";

function build() {
  return new McpServer({ name: "test", version: "1.0.0", instructions: "hi" }).tool(
    {
      name: "echo",
      title: "Echo",
      description: "Returns what it was given",
      inputSchema: { type: "object", properties: { v: { type: "string" } }, required: ["v"] },
    },
    async (args) => (args["v"] === "boom" ? failure("exploded") : text({ got: args["v"] })),
  );
}

const call = (method: string, params?: unknown, id: unknown = 1) =>
  build().handle({ jsonrpc: "2.0", id, method, params } as never);

describe("MCP protocol", () => {
  it("announces its protocol version and tool capability on initialize", async () => {
    const r = (await call("initialize")) as { result: Record<string, any> };
    assert.equal(r.result["protocolVersion"], "2025-06-18");
    assert.ok(r.result["capabilities"].tools, "a server with tools must say so");
    assert.equal(r.result["serverInfo"].name, "test");
    assert.equal(r.result["instructions"], "hi");
  });

  it("lists tools with the schema a client needs to call them", async () => {
    const r = (await call("tools/list")) as { result: { tools: any[] } };
    assert.equal(r.result.tools.length, 1);
    assert.equal(r.result.tools[0].name, "echo");
    assert.deepEqual(r.result.tools[0].inputSchema.required, ["v"]);
  });

  it("runs a tool and returns its content", async () => {
    const r = (await call("tools/call", { name: "echo", arguments: { v: "hello" } })) as {
      result: { content: { text: string }[] };
    };
    assert.match(r.result.content[0]!.text, /"got": "hello"/);
  });

  it("reports a tool failure as a result, not a transport error", async () => {
    // A failing tool must not look like a broken server, or the client stops
    // trying instead of showing the user what went wrong.
    const r = (await call("tools/call", { name: "echo", arguments: { v: "boom" } })) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    assert.equal(r.result.isError, true);
    assert.equal(r.result.content[0]!.text, "exploded");
  });

  it("rejects an unknown tool with an invalid-params error", async () => {
    const r = (await call("tools/call", { name: "nope" })) as { error: { code: number } };
    assert.equal(r.error.code, -32602);
  });

  it("rejects an unknown method that expects a reply", async () => {
    const r = (await call("resources/list")) as { error: { code: number } };
    assert.equal(r.error.code, -32601);
  });

  it("stays silent on notifications, which take no reply", async () => {
    assert.equal(await build().handle({ jsonrpc: "2.0", method: "notifications/initialized" } as never), null);
    assert.equal(await build().handle({ jsonrpc: "2.0", method: "notifications/unheard-of" } as never), null);
  });

  it("answers ping, which is how a client checks we are alive", async () => {
    const r = (await call("ping")) as { result: unknown };
    assert.deepEqual(r.result, {});
  });

  it("echoes the request id back, so replies can be matched", async () => {
    const r = (await call("ping", undefined, "abc-42")) as { id: string };
    assert.equal(r.id, "abc-42");
  });
});

describe("MCP stdio framing", () => {
  it("answers one request per line and ignores blank lines", async () => {
    const lines = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      "",
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    ].join("\n") + "\n";

    const out: string[] = [];
    await build().serve(
      Readable.from([lines]) as never,
      { write: (chunk: string) => out.push(chunk) } as never,
    );

    const replies = out.join("").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(replies.map((r) => r.id), [1, 2], "the notification must produce no reply");
  });

  it("reports a parse error rather than dying on malformed input", async () => {
    const out: string[] = [];
    await build().serve(
      Readable.from(["{ not json\n"]) as never,
      { write: (chunk: string) => out.push(chunk) } as never,
    );
    assert.equal(JSON.parse(out.join("")).error.code, -32700);
  });
});

describe("what the MCP tools tell an agent a call costs", () => {
  it("carries no price a reader could act on that we did not generate", async () => {
    const { DEFAULT_PRICE_USD } = await import("../src/server/config.ts");
    const { PRICE_LOOKUP, PRICE_DOSSIER } = await import("../src/hosaka/server/routes.ts");
    const { TIERS } = await import("../src/hosaka/server/bundle.ts");
    const { SUPPLIERS } = await import("../src/hosaka/suppliers/types.ts");
    const { readFileSync } = await import("node:fs");

    // A price written into prose goes stale in silence: the tool keeps working,
    // the agent budgets for the old number, and the challenge asks for another.
    // The bundles are what a stranger installs from npm and reads, comments
    // included, so every dollar figure in them — quoted to an agent or
    // explained to a human — has to be one we actually charge or pay.
    const ours = new Set(
      [
        DEFAULT_PRICE_USD,
        PRICE_LOOKUP,
        PRICE_DOSSIER,
        ...Object.values(TIERS).map((t) => t.priceUsd),
        ...Object.values(SUPPLIERS).flatMap((s) => [s.listPriceUsd, s.maxPriceUsd]),
      ].map((n) => `$${n}`),
    );

    for (const bundle of ["packages/deadchannel-mcp/src/server.mjs", "packages/hosaka-mcp/src/server.mjs"]) {
      const source = readFileSync(new URL(`../${bundle}`, import.meta.url), "utf8");
      const stale = [...new Set(source.match(/\$\d+\.\d+/g) ?? [])].filter((p) => !ours.has(p));
      assert.deepEqual(stale, [], `${bundle} names prices we do not charge: ${stale.join(", ")}`);
    }
  });
});
