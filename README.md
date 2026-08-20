# deadchannel

A risk oracle for x402 endpoints. Give it a URL, it tells an agent whether that
endpoint is alive, honestly priced, and safe to call — **without spending a cent**.

Roughly 17% of probed x402 endpoints are dead or traps, and the Bazaar discovery
layer ships no ranking, quality, or reputation signal by its own admission. An
agent picking from that catalog is guessing with real money.

## What it checks

Every verdict comes from unpaid `402` responses, which is what makes it cheap
enough to run across a whole catalog.

| Signal | What it catches |
| --- | --- |
| `reachable` | Endpoint answers at all, consistently |
| `bot-gate` | A bot wall answers agents while browsers get a clean 402 — the endpoint is invisible to indexers |
| `speaks-402` | Returns parseable payment requirements (v1 body **and** v2 `payment-required` header) |
| `gate-closed` | Advertises a price it does not enforce — anyone can take the content free |
| `price-sane` | Price sits inside $0.0001–$5; above the ceiling one call can drain a budget |
| `price-stable` | Quote does not move between probes taken seconds apart |
| `pay-to-valid` | Payout address is well formed for its chain and is not a burn address |
| `network-mainnet` | Settles somewhere that can hold real value, not testnet only |
| `network-known` | Chain identifier is recognizable (CAIP-2 or friendly name) |
| `schema-advertised` | Agent can know the response shape *before* paying |
| `bazaar-metadata` | Publishes `serviceName` / `tags` so topic search can find it |
| `latency` | p99 inside the 5s budget agents typically allow |
| `spec-clean` | Payload matches the documented shape; deviations are reported, not swallowed |

Verdicts: `live`, `degraded`, `trap`, `testnet`, `dead`, `unknown`, plus a
bounded 0–100 risk score.

## Use

Requires Node 22+. There are **no runtime dependencies** — types are stripped
natively, so there is no build step and nothing to audit but this repo.

```
node src/cli.ts https://x402.org/protected
node src/cli.ts --quiet --samples 5 url-a url-b url-c
node src/cli.ts --json url > verdict.json
```

Exit code is non-zero when any target is a `trap` or `dead`, so it drops into CI
as a guard against shipping an agent pointed at a bad endpoint.

```
TESTNET   risk 80   $0.01  355ms p99  https://x402.org/protected
  x network-mainnet   Only testnet networks offered (base-sepolia, solana-devnet).
                      This endpoint cannot accept real value.
  ! schema-advertised No input or output schema. An agent has to pay before it
                      can find out what it gets back.
```

## First full catalog scan — 20 Aug 2026

`node src/scan.ts --live 150` pulls every resource the public Bazaar facilitators
publish and audits it. Results over **14,979 resources**:

| | |
| --- | --- |
| catalog held by the top 3 payout addresses | **18.4%**, receiving **1 call in 80** |
| publish no discovery tags | **40.9%** — an agent searching by topic never finds them |
| pass every check | **56.8%** |
| of the 150 busiest, live right now | **91.3%** |
| of the busiest, genuinely dead | **2.0%** |

Median price $0.01, range $0 to $1,000, 316,927 paid calls in 30 days.

The catalog is in better shape than the folklore suggests. What it is not is
evenly distributed: three addresses list 2,750 resources between them and receive
one call in eighty, which makes them roughly 15x over-represented relative to the
demand they serve. Catalog size is not catalog depth.

![catalog audit](data/x402-catalog-audit.png)

### A correction, and the guard against repeating it

An earlier version of this table claimed 89.8% of the catalog published no tags.
That was wrong. The loader read `extensions.bazaar.tags` only, while most
publishers put tags on the item root — the real figure is 40.9%.

The bug survived review because nothing asserted the *positive* count. A check
that only ever counts what is missing cannot tell "publishers omit this" apart
from "we are looking in the wrong place." `test/catalog.test.ts` now hand-counts
tags across all three known locations in a captured 200-item slice of the live
catalog and asserts the loader matches exactly, in both directions.

## Notes from the wild

Built against live endpoints, not the spec alone:

- **v2 moves payment requirements into a base64 `payment-required` header** and
  leaves the body as `{}`. A parser that only reads the body marks the official
  reference endpoint as dead.
- **v2 sends CAIP-2 network ids** (`eip155:84532`, `solana:EtWTRA…`) where v1 sent
  friendly names. Both are live simultaneously.
- **v2 renames `maxAmountRequired` to `amount`** and hoists shared `resource`
  metadata to the payload root.
- Several servers omit the top-level `x402Version` the reference implementations
  all send, and some nest `accepts[]` one level deeper than documented. Both are
  parsed and reported as warnings rather than rejected.
- **Most resources are POST.** Probing them with GET returns 404/405, which looks
  exactly like a dead endpoint — it put our first live-probe dead rate at 25%
  when the real figure is 2.7%. The verb comes from the catalog now, with a POST
  retry when it is unknown. Any x402 index reporting a high dead rate is worth
  checking for this.
- **Discovery metadata is scattered.** The spec puts `serviceName`/`tags` on the
  ResourceInfo object, the CDP catalog flattens them onto the item root, and a
  minority nest them under `extensions.bazaar`. Read one location and you will
  undercount by half.
- **Brokered rails exist.** AWS Marketplace resources name the payee with a URN
  under an `aws:base` network instead of a chain address. That is legitimate, but
  the funds go to the broker, so it is reported as a warning rather than scored
  as an invalid payout.

## Selling

The service sells its own check over x402. `src/server/` implements the seller
side of the v2 HTTP transport: `PAYMENT-REQUIRED` out, `PAYMENT-SIGNATURE` in,
`PAYMENT-RESPONSE` back, in the authorization flow — verify, run the resource,
then settle.

**No private key is involved.** A seller declares where settlement should land;
the buyer signs and the facilitator broadcasts. The payout address is therefore
public information and lives in `deadchannel.config.json`, where anyone can
audit it, rather than in a dashboard where nobody can.

Settlement runs only after the probe produced a result, so a failure on our side
costs the buyer nothing.

```
GET  /             service card, free
GET  /health       liveness, free
GET  /facilitator  proves credentials are accepted, free, moves no money
POST /probe        the check, $0.001 in USDC on Base
```

`GET /facilitator` exists because a wrong credential otherwise stays invisible
until someone tries to pay, and the first to discover it would be a customer.

## Live

The service is deployed at **https://deadchannel.vercel.app**, selling on Base
mainnet at $0.001 per call and settling through the Coinbase facilitator.

First settled payment: [`0x6ac4a22c`](https://basescan.org/tx/0x6ac4a22c0b7721c9a5103d98ee3d546c120293e97bb5b7a2ca13fabed28e319b),
block 50230005, 20 Aug 2026. Gas was paid by the facilitator, not the buyer —
in x402 the buyer only signs, so a wallet holding nothing but USDC can pay.

`npm run validate` re-runs the 25 preflight checks the Bazaar applies before it
will index a resource, and reports whether the listing is currently active. It
needs no key and moves no money.

```
resource : https://deadchannel.vercel.app/probe
valid    : true
accepted : accepted
checks   : 25/25 passed
indexed  : active=true
```

## Development

```
npm install     # typescript only, for typechecking
npm test        # 18 tests, no network required
npm run typecheck
```

## License

MIT
