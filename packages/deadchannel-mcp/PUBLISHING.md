# Publishing deadchannel-mcp

Two registries, in this order. npm first, because the MCP registry verifies that
the npm package exists and names it back.

## 1. npm

The package must declare `mcpName` matching the registry namespace — that is how
the MCP registry proves the same person controls both. It already does.

```bash
npm login                       # opens the browser
cd packages/deadchannel-mcp
npm publish --access public
```

## 2. The MCP registry

Authentication is GitHub OAuth against the `io.github.plus8bit` namespace, which
is proven by owning that GitHub account.

```bash
cd packages/deadchannel-mcp
mcp-publisher login github       # prints a code, opens the browser
mcp-publisher publish
```

`mcp-publisher validate server.json` checks the manifest without publishing.

## Releasing a new version

Three numbers have to agree or the registry rejects the publish:
`package.json` version, `server.json` version, and `server.json`
`packages[0].version`. A test holds this, because the rejection lands *after*
npm has accepted the release — leaving a published package no client can find.

```bash
npm run build:mcp-deadchannel                # rebuild the bundle from src/
# bump all three versions
npm publish --access public
mcp-publisher publish
```
