# hosaka-mcp

Company facts for AI agents, paid per call in USDC on Base. No signup, no API key.

## Tools

| tool | price | what you get |
| --- | --- | --- |
| `hosaka_lookup` | $0.005 | domain age, registrar, mail and DNS provider, DMARC, HTTPS, vendor count |
| `hosaka_dossier` | $0.05 | every third-party vendor the company can be proven to use, each with its proof |

## Why the dossier is worth having

A company proves ownership to every SaaS product it buys by placing a DNS
verification record, and authorises every sender it uses in its SPF record.
Those two lists are a purchase history the company published itself.

Asking for `figma.com` returns Anthropic, OpenAI, Adobe, Atlassian, MongoDB
Atlas, Greenhouse, Docusign, Stripe, Notion, Dropbox and Zendesk — each with the
exact record that proves it, so you can check rather than trust.

Page fingerprints require a loaded script or CDN host, never a mention. A site
listing a vendor's logo among its integrations is not a site that uses it.

## Install

```json
{
  "mcpServers": {
    "hosaka": {
      "command": "npx",
      "args": ["-y", "hosaka-mcp"],
      "env": { "HOSAKA_PRIVATE_KEY": "0x…" }
    }
  }
}
```

`HOSAKA_PRIVATE_KEY` is a wallet holding a little USDC on Base. It signs
payments locally and never leaves your machine — what goes over the wire is a
signature, never the key. A few dollars covers hundreds of calls.

Gas is paid by the facilitator, not by you, so the wallet needs USDC only.

## Source

[github.com/plus8bit/deadchannel](https://github.com/plus8bit/deadchannel)
