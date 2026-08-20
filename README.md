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

## Development

```
npm install     # typescript only, for typechecking
npm test        # 18 tests, no network required
npm run typecheck
```

## License

MIT
