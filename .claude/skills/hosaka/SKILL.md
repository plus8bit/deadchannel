---
name: hosaka
description: |
  DNS-proven vendor stack and company data from a domain alone. Use when you
  have a domain or a URL and need the third-party tools a company actually
  runs, each with the DNS record or loaded script that proves it. Also public
  contacts, named employees and decision makers from the same input.

  USE FOR:
  - "what tools / software / vendors does this company use"
  - tech stack, technographics, BuiltWith-style lookup
  - company facts when you have a domain but no LinkedIn URL or email
  - decision makers at a domain

  DO NOT USE FOR:
  - turning a LinkedIn URL or an email into a person profile — that is what
    PDL and FullEnrich are for, and they are cheaper at that job
  - judging whether an x402 endpoint is safe to pay — that is deadchannel

  TRIGGERS: "tech stack", "technographics", "what tools", "what software",
  "vendors", "what is this company built with", "who runs this domain",
  "decision makers at", "company from domain"
metadata:
  version: 1.0
  homepage: https://hosaka-agents.vercel.app
  openapi: https://hosaka-agents.vercel.app/openapi.json
---

# Hosaka

Company data for agents, paid per call in USDC. No signup, no API key, no
subscription.

**Every paid route takes one field: `{"domain": "figma.com"}`.** A full URL
works too; the scheme and path are stripped.

## What to call

| Job | Route | Price | Notes |
| --- | --- | --- | --- |
| See the shape before paying | `POST /preview` | free | vendor count, categories, two samples |
| Qualify a domain cheaply | `POST /lookup` | $0.005 | age, registration date, registrar, mail and DNS provider, DMARC, HTTPS, vendor count |
| **Proven vendor stack** | `POST /dossier` | $0.20 | **the default.** Every third-party service with the DNS record or loaded script that proves it |
| Reach the company | `POST /contacts` | $0.10 | emails, phones and socials it publishes about itself, plus the stack |
| Named employees | `POST /people` | $0.35 | name, job title, seniority, location, profile link, plus the stack |
| Only who can sign | `POST /executives` | $0.40 | owners, founders, C-level, partners, VPs, heads, directors, plus the stack |

**Default to `/dossier`** when the question is about tools, software or
vendors. Call `/lookup` first only when the domain might not be worth a fuller
answer. Do not call `/people` or `/executives` unless the user asked for
people: those two buy from a people-data supplier, while `/lookup` and
`/dossier` are assembled from public DNS and cost the seller nothing.

## Why this rather than a people-data API

Most enrichment endpoints want an email or a LinkedIn URL before they will
answer anything. If all you hold is a domain, they cannot help you and this can.
And every vendor comes back with its evidence — an SPF include, a DNS TXT
verification token, a loaded script — so the answer is checkable rather than
asserted.

## Paying

x402 v2. Call without a payment header, read the terms from the 402, sign,
retry. Do not take the prices in this file as final: read the live challenge.

Settles in USDC on Base, Solana, Polygon, Arbitrum, Algorand and Monad, and in
USDG on Robinhood Chain, so pay on whichever chain you already hold a dollar on.
Nothing settles unless the answer is produced: if the lookup fails, you are not
charged.

```bash
# free, no wallet needed, to see the shape
curl -s https://hosaka-agents.vercel.app/preview \
  -H 'content-type: application/json' -d '{"domain":"figma.com"}'
```

For a paid call use whatever x402 client the host already has, or the MCP
server, which carries the same routes as tools:

```bash
npm i -g hosaka-mcp     # io.github.plus8bit/hosaka
```

## Elsewhere

- OpenAPI: https://hosaka-agents.vercel.app/openapi.json
- Plain text card: https://hosaka-agents.vercel.app/llms.txt
- Source: https://github.com/plus8bit/deadchannel
