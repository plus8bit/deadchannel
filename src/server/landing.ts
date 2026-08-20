import type { Config } from "./config.ts";
import { PROBE_ROUTE } from "./routes.ts";

/**
 * The human-readable face of the service.
 *
 * Served only when the client asks for HTML. Agents get the JSON service card
 * from the same URL, which is what content negotiation is for — one canonical
 * address, two audiences, no separate marketing domain to drift out of sync.
 *
 * Deliberately single-theme: this is a terminal-shaped tool and the page commits
 * to that, so every colour is painted explicitly rather than inherited.
 */
/**
 * The site mark: a flat carrier with a single spike.
 *
 * Drawn rather than lettered because a favicon is 16 pixels and type is
 * unreadable there. Two shapes survive that size: the flatline reads as the
 * dead channel, the spike as the thing worth catching.
 */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="7" fill="#0C0E13"/>
<path d="M4 20h6l3-11 4 17 3-9h8" fill="none" stroke="#E8873A" stroke-width="2.6"
      stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export function landingPage(cfg: Config): string {
  const price = `$${cfg.priceUsd}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>deadchannel</title>
<meta name="description" content="Risk check for any x402 endpoint. Tells an agent whether an endpoint is alive, honestly priced and safe to call, before it spends money.">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="apple-touch-icon" href="/favicon.svg">
<meta name="theme-color" content="#0C0E13">
<meta property="og:title" content="deadchannel">
<meta property="og:description" content="Risk check for any x402 endpoint. Tells an agent whether an endpoint is alive, honestly priced and safe to call, before it spends money.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0C0E13;--surface:#12151B;--line:#1E232C;--ink:#E6EAF0;--dim:#8A93A1;--faint:#5A6270;--amber:#E8873A;--green:#6FAE8F;--steel:#74A6B6}
html{background:var(--bg)}
body{background:var(--bg);color:var(--ink);font:15.5px/1.65 "IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;-webkit-font-smoothing:antialiased}
.wrap{max-width:820px;margin:0 auto;padding:56px 24px 96px}
h1{font-family:Archivo,system-ui,sans-serif;font-size:clamp(38px,8vw,62px);font-weight:800;letter-spacing:-.035em;line-height:1}
h1 b{color:var(--amber)}
.tag{color:var(--dim);font-size:15px;margin-top:14px;max-width:62ch}
.status{display:flex;flex-wrap:wrap;gap:10px;margin:30px 0 0}
.pill{border:1px solid var(--line);background:var(--surface);padding:7px 13px;font-size:12.5px;color:var(--dim);letter-spacing:.02em}
.pill i{font-style:normal;color:var(--green)}
.pill s{text-decoration:none;color:var(--amber)}
h2{font-family:Archivo,system-ui,sans-serif;font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin:56px 0 18px}
p{color:var(--dim);max-width:66ch;margin-bottom:14px}
p strong{color:var(--ink);font-weight:600}
pre{background:var(--surface);border:1px solid var(--line);border-left:2px solid var(--amber);padding:16px 18px;overflow-x:auto;font-size:13px;line-height:1.7;color:var(--ink)}
pre .c{color:var(--faint)}
pre .s{color:var(--green)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin-top:6px}
td{padding:9px 12px 9px 0;border-bottom:1px solid var(--line);vertical-align:top;color:var(--dim)}
td:first-child{color:var(--ink);white-space:nowrap;width:1%;padding-right:22px}
.n{color:var(--amber);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin-top:6px}
.cell{background:var(--surface);padding:16px 18px}
.cell b{display:block;font-family:Archivo,sans-serif;font-size:27px;font-weight:800;letter-spacing:-.03em;color:var(--amber);line-height:1}
.cell span{display:block;color:var(--faint);font-size:11.5px;margin-top:8px;letter-spacing:.05em;line-height:1.45}
a{color:var(--amber);text-decoration:none;border-bottom:1px solid #55351a}
a:hover{border-bottom-color:var(--amber)}
a:focus-visible{outline:2px solid var(--amber);outline-offset:3px}
footer{margin-top:64px;padding-top:22px;border-top:1px solid var(--line);color:var(--faint);font-size:12.5px;line-height:1.8}
.by{margin-top:18px;padding-top:16px;border-top:1px solid var(--line);color:var(--dim)}
.by span{color:var(--faint)}
@media(max-width:520px){.by span{display:block;margin-top:2px}.by span::before{content:none}}
</style></head><body><div class="wrap">

<h1>dead<b>channel</b></h1>
<p class="tag">Risk check for any x402 endpoint. Tells an agent whether an endpoint is alive, honestly priced and safe to call &mdash; before it spends money on finding out.</p>

<div class="status">
  <span class="pill"><i>&#9679;</i> live on Base mainnet</span>
  <span class="pill">indexed in the <s>Bazaar</s></span>
  <span class="pill">${price} per call, in USDC</span>
  <span class="pill">you pay only on a result</span>
</div>

<h2>Why</h2>
<p>We audited every resource the public Bazaar publishes &mdash; <strong>14,979 of them</strong>. The catalog is healthier than the folklore says, but it is not evenly distributed, and it is largely undescribed.</p>
<div class="grid">
  <div class="cell"><b>18.4%</b><span>OF THE CATALOG BELONGS TO 3 PAYOUT ADDRESSES, TAKING 1 CALL IN 80</span></div>
  <div class="cell"><b>40.9%</b><span>PUBLISH NO DISCOVERY TAGS, SO TOPIC SEARCH NEVER FINDS THEM</span></div>
  <div class="cell"><b>56.8%</b><span>PASS EVERY CHECK WE RUN</span></div>
</div>
<p style="margin-top:16px">An agent picking from that catalog is guessing with real money. This service is the check it can run first.</p>

<h2>Use it</h2>
<pre><span class="c"># any x402 client; the 402 carries the price and terms</span>
curl -X POST <span class="s">${cfg.publicUrl}${PROBE_ROUTE.path}</span> \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"url":"https://api.example.com/paid-endpoint"}'</span></pre>
<p style="margin-top:14px">You get a verdict &mdash; <strong>live</strong>, <strong>degraded</strong>, <strong>trap</strong>, <strong>testnet</strong> or <strong>dead</strong> &mdash; a 0&ndash;100 risk score, and the specific problems found. Settlement happens only after the check produces a result, so a failure on our side costs you nothing.</p>

<h2>What it checks</h2>
<table>
<tr><td>reachable</td><td>answers at all, consistently</td></tr>
<tr><td>bot&#8209;gate</td><td>a bot wall answers agents while browsers get a clean 402, so indexers never see it</td></tr>
<tr><td>speaks&#8209;402</td><td>parseable payment requirements, v1 body and v2 header alike</td></tr>
<tr><td>gate&#8209;closed</td><td>advertises a price it does not enforce</td></tr>
<tr><td>price&#8209;sane</td><td>inside $0.0001&ndash;$5; above the ceiling one call can drain a budget</td></tr>
<tr><td>price&#8209;stable</td><td>the quote does not move between probes seconds apart</td></tr>
<tr><td>pay&#8209;to&#8209;valid</td><td>payout address well formed for its chain, and not a burn address</td></tr>
<tr><td>network</td><td>settles somewhere that holds real value, on a chain you recognize</td></tr>
<tr><td>schema</td><td>you can know the response shape before paying</td></tr>
<tr><td>latency</td><td>p99 inside the budget agents allow</td></tr>
</table>

<h2>Honest notes</h2>
<p>Every verdict comes from the unpaid 402 an endpoint already returns. <strong>We never pay the endpoints we grade</strong>, which is what makes it cheap enough to run across a whole catalog &mdash; and also means we cannot tell you whether a service delivers good output, only whether it is safe to try.</p>
<p>The tool is open source, including the checks and their weights, so you can disagree with a verdict and see exactly why we reached it.</p>

<footer>
  <a href="https://github.com/plus8bit/deadchannel">github.com/plus8bit/deadchannel</a> &middot; <a href="${cfg.publicUrl}/facilitator">facilitator status</a> &middot; settles to <span style="color:var(--dim)">${cfg.payTo.slice(0, 10)}&hellip;${cfg.payTo.slice(-6)}</span> on ${cfg.network.label}<br>
  Machine clients get JSON from this same URL. Ask for <span style="color:var(--dim)">application/json</span>.
  <div class="by">built by <a href="https://x.com/plus8bit">@plus8bit</a><span>&nbsp;&middot;&nbsp;the first customer was a for loop</span></div>
</footer>

</div></body></html>`;
}
