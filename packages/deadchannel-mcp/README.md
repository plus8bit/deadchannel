# deadchannel-mcp

Check an x402 endpoint before you pay it.

An agent with a wallet can now buy from strangers. Nothing checks the stranger.
`deadchannel_probe` grades an endpoint for **$0.005** in USDC on Base — less
than the smallest payment it protects — and returns a verdict, a risk score,
and the specific findings behind both.

```
live      answers, settles, priced as listed
degraded  answers, but something is wrong
trap      takes payment and returns nothing usable
testnet   a testnet address advertised as mainnet
dead      does not answer at all
```

## Install

```json
{
  "mcpServers": {
    "deadchannel": {
      "command": "npx",
      "args": ["-y", "deadchannel-mcp"],
      "env": { "DEADCHANNEL_PRIVATE_KEY": "0x..." }
    }
  }
}
```

The key signs payments locally and never leaves the machine; only a signature
is sent. Point it at a wallet holding a little USDC on Base — a dollar buys a
thousand checks. `deadchannel_health` needs no key at all, so you can tell "the
service is down" apart from "my key is wrong" before spending anything.

## Tools

| Tool | Cost | What it answers |
| --- | --- | --- |
| `deadchannel_probe` | $0.005 | Is this endpoint safe to pay? |
| `deadchannel_health` | free | Is deadchannel itself up? |

No signup, no API key, no account. MIT licensed —
[github.com/plus8bit/deadchannel](https://github.com/plus8bit/deadchannel).
