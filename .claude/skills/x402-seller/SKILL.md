---
name: x402-seller
description: Playbook for running Hosaka and deadchannel as x402 sellers — how the CDP catalog actually indexes and ranks, what sells and what does not, the config and rail traps that cost us money, and the verification order that stops false findings reaching a post. Use when working on listings, prices, descriptions, rails, catalog position, or anything about selling to agents on x402.
---

# Selling on x402

Everything here was measured on our own deployment or on the public catalog. Where
something is a hypothesis rather than a measurement, it says so.

## The rule that matters most

**Never invent a value.** Not an address, not a name, not a number, not a link. A
plausible guess presented as a finding is worse than an admission of ignorance,
because it spends someone else's credibility. Thirty outreach letters went out
with `info@<domain>` filled in by pattern while the text said the domains had
been run through our own tooling; what had actually run was `/preview`, which
returns no addresses at all. The first four bounced. Say "not found" and name
what it would take to find it.

Say where a value came from when you hand it over, and never describe a step in
words that overstate what it did.

**Measure first, propose second.** In one working day this project produced five
directions that died the moment they were checked: a price-intelligence product
(niche populated, 2-6 calls each), a novelty endpoint (23 cents a month), RWA and
equities (no demand, plus a brokerage licence), a catalog-health report (nothing
is broken), and free-tier pricing (arithmetic error in my own script). Each was
proposed before it was checked.

It also produced four false alarms about our own code: `ageYears: 0` was correct,
a "dead" endpoint was alive, a price override lived in a file rather than an env
var, and 94% of a competitor's endpoints looked broken because they were GET and
I sent POST.

The order is: pull the number, do the arithmetic by hand, then say the thing.

## How the catalog actually works

- **A route is indexed only after a settled payment.** No registration endpoint
  exists. `POST /platform/v2/x402/validate` (no key needed) reports `valid`,
  `simulation.outcome` and whether the resource is `index.active`.
- **The record refreshes on settlement, not on deploy.** A rewritten description
  or a new rail reaches the catalog when money next moves, so a listing can
  advertise a price the endpoint no longer charges.
- **Quality metrics recompute on a six-hour schedule.** Counters lag; do not read
  a position ten minutes after a payment and conclude anything.
- **Ranking is per resource, not per merchant.** A popular endpoint lifts itself
  and nothing else you sell.
- **Buyer reach is the metric.** `l30DaysUniquePayers` is what separates listings.
  Twenty calls from one wallet add volume and recency and no reach at all.
- **Thirty days without a settlement removes a resource from the catalog.**
- **The lag is hours, not minutes, and it is easy to mistake for a fault.**
  `/probe` sat at two networks and seven calls through two Solana settlements and
  one on Base, which looked like non-CDP facilitators being invisible to the
  catalog. They are not: the record caught up to three networks later the same
  day. Wait a cycle before diagnosing.
- The price in the record lags separately from the networks. `/probe` advertised
  $0.001 in the catalog while the live challenge asked $0.005, which is exactly
  the mismatch that makes an agent fail on its first call.

### The payer leaderboard is farmed

`onesource.io` held 23 of the top 24 slots by unique payers with calls almost
exactly equal to payers — around 1,100 wallets calling each endpoint once. Real
usage looks like Exa search: 244 payers, 16,806 calls, 69 per payer. **Rank by
calls per payer, not by payers**, or the map is a picture of somebody's campaign.

## What sells and what does not

Measured over 6,000 catalog records.

Agents pay repeatedly for **watchable state**: Twitter search (1,252 calls per
payer), flight seats (931), token safety (697), Google Trends (178), BTC
liquidations (134), web search (69). One-shot facts are asked once, which is why
a company dossier will never see those ratios.

Agents do **not** buy tools about x402 itself. Price comparison, routing, catalog
monitoring, reliability feeds, endpoint checks: every one of them sits at 1-6
calls a month across a dozen sellers. This is the single most expensive lesson
here, because it applies to deadchannel.

Reselling is not automatically doomed but is doomed without distribution: five
resellers of Exa search sit above the original's own price and still take volume.
Entering as the sixth, with no name, is the position we already failed from.

## Writing a listing

- **500 characters, hard.** Past it the CDP facilitator rejects verify and settle,
  so an overlong description does not rank badly, it stops the endpoint being paid.
- **Lead with the verb.** The four endpoints outranking ours carried no tags and
  one-line descriptions beginning "Find". Ours began "Use when all you have is a
  company domain", which reads as a sentence about domains.
- **Use the buyer's words, not the industry's.** We said vendor, technographics,
  third-party; buyers type software, tools, runs on. Two of six phrasings returned
  us nothing until those words were added.
- **Retrieval fails before ranking does.** A plain question can return two results
  out of 15,180, neither of them relevant. Check several phrasings before assuming
  a position is a position.
- Sell the **input contract** when it differs. PDL earns $559 a month from 76
  buyers while demanding an email or a LinkedIn URL; an agent holding only a domain
  cannot call it at all and can call ours.
- Never make a comparative price claim. Ours outlived its supplier by days inside
  a published npm package. A test now bans them from the bundles.
- **A price lives in more places than anyone remembers.** Eleven surfaces have now
  been caught quoting a dead price: the config, the code default, three READMEs,
  the OpenAPI guidance, llms.txt, the landing page, two npm descriptions and the
  MCP registry manifest. Every single one was found by looking, none by a report.

## Traps that cost us money or time

- **Config precedence is env, then `<shop>.config.json`, then the code default.**
  A price raise that edits only the default changes nothing. Always read the live
  402 after deploying, never the source.
- **Env vars silently disable code.** Solana stayed dark until
  `X402_SOLANA_PAY_TO` was set; the rail had been written and deployed for days.
- **Probe an endpoint with the method the catalog declares.** 315 of 455 sampled
  endpoints are GET. POST-by-default produced a 94% false-broken rate.
- **Health-check every advertised rail, not the primary one.** deadchannel
  advertised three chains and verified one, so a rail with no credentials looked
  healthy until a buyer paid for an answer they could not receive.
- **A supplier ceiling above the shelf price sells at a loss silently.** Every
  resale tier must keep at least 15% of its price at the highest cost we authorise.
- **Truncating a supplier's error costs the next purchase.** 200 characters hid the
  parameter name a rejection was already naming; keep 2000.
- **Ask before paying.** These endpoints validate before they settle, so a rejected
  request is free and its error text is the cheapest schema there is.

## Published is not local

`npm publish` is the only guard the repository cannot enforce. Both MCP packages
sat on npm for days quoting prices from before a repricing, because changing a
price rebuilds the bundle in the working tree and nothing republishes it. The
understatement is the dangerous direction: an agent budgets the old number and
fails on its first call.

`npm run check:published` downloads the tarballs a buyer would install and
compares them to the live challenge. Run it after any price change, and read the
result carefully: comments carry supplier costs, and an `outputExample` carries
the price of whatever the tool was aimed at. Neither has to match our shelf.

## Counting is already done for you

Before building a counter, look at what the host records. Vercel groups runtime
logs by `requestPath` over about seven days at no cost and no code, which is the
whole of "how many people asked". Line-level logs are billing-limited to roughly
a day on Hobby, so a log line is worth adding only for what the aggregate cannot
say: which domain, and whether the caller was us. Filter our own traffic at read
time by marking it, never at write time — a filter applied on the way in cannot
be undone on the way out. Web Analytics is a separate switch in the dashboard and
is off until somebody turns it on.

## The money map

- **Revenue wallet** holds no key on any server; it only receives.
- **Operating wallet** pays suppliers, and pays them *before* our own settlement
  lands, so it needs a float or the order fails mid-flight.
- Suppliers settle on Base only (`buy.ts` hardcodes `eip155:8453`), whichever chain
  the buyer paid on.
- Zero-marginal-cost shelves (`/lookup`, `/dossier`) move money between our own
  wallets and cost nothing; resale shelves lose the supplier fee on every call.
- Solvador settles Solana, Monad and Robinhood free for 1,000 payments a month,
  then $0.001 each. Price anything on those rails above that.

## Free before paid

`/preview` on our own shop, the CDP validator, the discovery search, and reading
any seller's 402 are all free. A survey of eighteen live sellers through the free
preview found two real defects in our own output at zero cost, which is more than
any paid self-call has ever produced.

## Distribution, in the order that has worked

1. **The MCP registry and npm.** The only channel where an agent finds us without
   a ranking. Publishing needs `npm login` first — the session expires constantly
   and the failure reads as a 404 on PUT, not as an auth error.
2. **A settled payment**, which is what turns a rewritten listing into a live one.
3. **Own measurement, published.** The account's best format and the only one that
   travels without an audience, because it is checkable by anyone in ten seconds.
4. Cold outreach only with something specific and true to say. We abandoned a
   diagnosis campaign the moment measurement showed there was nothing wrong.
