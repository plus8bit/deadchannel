/**
 * Minimal Model Context Protocol server over stdio.
 *
 * Written against the wire format rather than pulling the SDK: MCP over stdio
 * is newline-delimited JSON-RPC, the surface we need is three methods, and the
 * rest of this project has no runtime dependencies. A dependency here would buy
 * nothing and cost an audit.
 */

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface Request {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const PROTOCOL_VERSION = "2025-06-18";

export class McpServer {
  readonly #info: ServerInfo;
  readonly #tools = new Map<string, { def: ToolDefinition; handler: ToolHandler }>();

  constructor(info: ServerInfo) {
    this.#info = info;
  }

  tool(def: ToolDefinition, handler: ToolHandler): this {
    this.#tools.set(def.name, { def, handler });
    return this;
  }

  /** Handles one request. Returns null for notifications, which take no reply. */
  async handle(request: Request): Promise<unknown | null> {
    const { id, method, params } = request;
    const isNotification = id === undefined;

    try {
      switch (method) {
        case "initialize":
          return reply(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: this.#info.name, version: this.#info.version },
            ...(this.#info.instructions ? { instructions: this.#info.instructions } : {}),
          });

        case "notifications/initialized":
          return null;

        case "tools/list":
          return reply(id, { tools: [...this.#tools.values()].map((t) => t.def) });

        case "tools/call": {
          const name = String(params?.["name"] ?? "");
          const entry = this.#tools.get(name);
          if (!entry) return error(id, -32602, `unknown tool: ${name}`);
          const args = (params?.["arguments"] ?? {}) as Record<string, unknown>;
          return reply(id, await entry.handler(args));
        }

        case "ping":
          return reply(id, {});

        default:
          // A notification we do not implement is simply ignored, per the spec.
          return isNotification ? null : error(id, -32601, `method not found: ${method}`);
      }
    } catch (err) {
      if (isNotification) return null;
      return error(id, -32603, err instanceof Error ? err.message : String(err));
    }
  }

  /** Reads newline-delimited JSON-RPC from stdin and answers on stdout. */
  async serve(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
    let buffer = "";
    input.setEncoding("utf8");

    for await (const chunk of input) {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) continue;

        let request: Request;
        try {
          request = JSON.parse(line);
        } catch {
          output.write(`${JSON.stringify(error(null, -32700, "parse error"))}\n`);
          continue;
        }
        const response = await this.handle(request);
        if (response !== null) output.write(`${JSON.stringify(response)}\n`);
      }
    }
  }
}

function reply(id: Request["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

function error(id: Request["id"], code: number, message: string) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message } };
}

export function text(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  };
}

export function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
