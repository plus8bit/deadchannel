import { PRICE_LOOKUP, PRICE_DOSSIER } from "./routes.ts";
import { TIERS } from "./bundle.ts";
import type { Config } from "../../server/config.ts";

/**
 * The page a person gets at the root, where an agent gets JSON.
 *
 * Both audiences arrive at the same URL wanting opposite things. An agent needs
 * the machine-readable card; a person following a link needs to understand in
 * ten seconds what this sells and why the data is unusual. Serving one of them
 * raw JSON is how a live shop looks abandoned.
 *
 * The styling is Gibson rather than neon cyberpunk: Hosaka is a Japanese
 * corporation in Neuromancer, so black, bone, and a single vermillion seal —
 * not three competing neons. One signature move (the katakana watermark), one
 * texture (CRT scanline at the edge of visibility), one staggered reveal.
 */
export function hosakaLanding(cfg: Config): string {
  const chains = cfg.algorandPayTo ? "BASE / ALGORAND" : cfg.network.label.toUpperCase();
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hosaka — company data for agents</title>
<meta name="description" content="Every third-party vendor a company can be proven to use, read from its own DNS. Sold to AI agents per call in USDC. No signup, no API key.">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#08090C">
<meta property="og:title" content="Hosaka — company data for agents">
<meta property="og:description" content="Every third-party vendor a company can be proven to use, read from its own DNS. Paid per call in USDC.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --void:#08090C; --panel:#0D0F14; --line:#191D25;
  --bone:#D6D9DE; --dim:#79808C; --faint:#464C57;
  --seal:#FF3B2F; --jade:#43D9A3;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --disp:"Chakra Petch",system-ui,sans-serif;
}
html{background:var(--void)}
body{background:var(--void);color:var(--bone);font:15px/1.7 var(--mono);-webkit-font-smoothing:antialiased;position:relative;overflow-x:hidden}
/* CRT scanline, at the edge of visibility */
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:99;
  background:repeating-linear-gradient(180deg,rgba(255,255,255,.017) 0 1px,transparent 1px 3px)}
.wrap{max-width:880px;margin:0 auto;padding:72px 26px 110px;position:relative}

/* staggered reveal, once, on load */
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.r{animation:rise .7s cubic-bezier(.2,.7,.3,1) both}
@media(prefers-reduced-motion:reduce){.r{animation:none}}

header{position:relative;padding-bottom:8px}
.kana{position:absolute;right:-6px;top:-30px;font-family:var(--disp);font-weight:700;
  font-size:clamp(70px,17vw,150px);line-height:1;color:#11141A;letter-spacing:.04em;
  user-select:none;pointer-events:none;z-index:0}
h1{position:relative;z-index:1;font-family:var(--disp);font-weight:700;
  font-size:clamp(44px,9vw,78px);line-height:.94;letter-spacing:-.02em}
h1 em{font-style:normal;color:var(--seal)}
.rule{height:1px;margin:26px 0 22px;background:linear-gradient(90deg,var(--seal),var(--line) 42%,transparent)}
.tag{position:relative;z-index:1;color:var(--dim);max-width:63ch}
.tag b{color:var(--bone);font-weight:500}

.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px}
.chip{border:1px solid var(--line);background:var(--panel);padding:6px 12px;
  font-size:11.5px;letter-spacing:.09em;color:var(--dim);text-transform:uppercase}
.chip i{font-style:normal;color:var(--jade)}

h2{font-family:var(--disp);font-weight:500;font-size:12px;letter-spacing:.24em;
  text-transform:uppercase;color:var(--seal);margin:62px 0 20px;
  display:flex;align-items:center;gap:14px}
h2::after{content:"";flex:1;height:1px;background:var(--line)}
p{color:var(--dim);max-width:68ch;margin-bottom:14px}
p strong{color:var(--bone);font-weight:500}

.proof{display:grid;grid-template-columns:repeat(auto-fit,minmax(255px,1fr));
  gap:1px;background:var(--line);border:1px solid var(--line);margin:4px 0 18px}
.p{background:var(--panel);padding:14px 16px;transition:background .25s}
.p:hover{background:#12151C}
.p b{font-family:var(--disp);font-weight:500;font-size:15px;letter-spacing:.01em}
.p code{display:block;color:var(--faint);font-size:11px;margin-top:6px;
  word-break:break-all;line-height:1.55}

table{border-collapse:collapse;width:100%;font-size:13.5px}
td{padding:11px 14px 11px 0;border-bottom:1px solid var(--line);vertical-align:top;color:var(--dim)}
td:first-child{color:var(--bone);white-space:nowrap;width:1%;padding-right:24px}
td.n{color:var(--seal);font-weight:700;text-align:right;width:1%;white-space:nowrap;font-size:14px}
tr:hover td{background:#0B0D11}

pre{background:var(--panel);border:1px solid var(--line);border-left:2px solid var(--seal);
  padding:16px 18px;overflow-x:auto;font-size:12.5px;line-height:1.75;color:var(--bone)}
pre .c{color:var(--faint)}
pre .s{color:var(--jade)}

a{color:var(--bone);text-decoration:none;border-bottom:1px solid var(--faint);transition:.2s}
a:hover{color:var(--seal);border-bottom-color:var(--seal)}
footer{margin-top:70px;padding-top:24px;border-top:1px solid var(--line);
  color:var(--faint);font-size:12px;line-height:1.9}
@media(max-width:560px){.kana{opacity:.55;top:-14px}}
</style></head><body><div class="wrap">

<header class="r">
  <div class="kana" aria-hidden="true">ホサカ</div>
  <h1>HOSAKA<em>.</em></h1>
  <div class="rule"></div>
  <p class="tag">Company data for AI agents, paid per call in USDC. It reads a company's <b>own DNS</b> to find every third-party vendor it can be proven to use, and hands back the record that proves each one.</p>
  <div class="meta">
    <span class="chip"><i>&#9679;</i> LIVE &middot; ${chains}</span>
    <span class="chip">NO SIGNUP &middot; NO API KEY</span>
    <span class="chip">FROM $${PRICE_LOOKUP} A CALL</span>
    <span class="chip">OPEN SOURCE</span>
  </div>
</header>

<section class="r" style="animation-delay:.09s">
<h2>The receipts are public</h2>
<p>A company proves it owns its domain to <strong>every SaaS product it buys</strong> by placing a verification record in DNS, and authorises every sender it uses in its SPF record. Those two lists are a purchase history the company published itself, sitting in the open, that nobody reads.</p>
<p>Ask for <strong>figma.com</strong>:</p>
<div class="proof">
  <div class="p"><b>Anthropic</b><code>TXT anthropic-domain-verification-4rt01s=&hellip;</code></div>
  <div class="p"><b>OpenAI</b><code>TXT openai-domain-verification=dv-JGOTRvDBX9eV2Gk8&hellip;</code></div>
  <div class="p"><b>Greenhouse</b><code>SPF include:mg-spf.greenhouse.io</code></div>
  <div class="p"><b>Zendesk</b><code>SPF include:mail.zendesk.com</code></div>
</div>
<p>Seventeen vendors for that one domain, each with its evidence, so a buyer can <strong>check rather than trust</strong>. Page fingerprints require a loaded script or CDN host, never a mention: a site listing a vendor's logo among its integrations is not a site that uses it.</p>
</section>

<section class="r" style="animation-delay:.18s">
<h2>Shelves</h2>
<table>
<tr><td>POST /lookup</td><td>domain age, registrar, mail and DNS provider, DMARC, HTTPS, vendor count</td><td class="n">$${PRICE_LOOKUP}</td></tr>
<tr><td>POST /contacts</td><td>the dossier, plus the emails and phones the company publishes about itself</td><td class="n">$${TIERS.contacts.priceUsd}</td></tr>
<tr><td>POST /dossier</td><td>every vendor the company can be proven to use, each with its evidence</td><td class="n">$${PRICE_DOSSIER}</td></tr>
<tr><td>POST /people</td><td>the dossier, plus named people who work there</td><td class="n">$${TIERS.people.priceUsd}</td></tr>
</table>
<p style="margin-top:18px">Four prices, so a cheap question never pays for an expensive answer.</p>
</section>

<section class="r" style="animation-delay:.27s">
<h2>Use it</h2>
<pre><span class="c"># any x402 client; the 402 carries the price and terms</span>
curl -X POST <span class="s">${cfg.publicUrl}/dossier</span> \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"domain":"figma.com"}'</span></pre>
<p style="margin-top:16px">Or let an agent find it alone. Published to npm and listed in the official MCP registry, so any MCP client discovers and pays for it with one line:</p>
<pre>npx -y <span class="s">hosaka-mcp</span></pre>
</section>

<section class="r" style="animation-delay:.36s">
<h2>The expensive shelves are resale</h2>
<p>Contacts and people cannot be produced from public records, so we buy them &mdash; from another x402 seller, <strong>in the same call</strong>, only once an order arrives. No inventory, no contract, no subscription. The supply chain is machines paying machines.</p>
<p>Every supplier carries a ceiling, so we refuse to buy above what we charge, and the wallet is checked before the purchase rather than after: a shop that finds out it is broke halfway through an order has already taken the buyer's money and has nothing to hand back.</p>
</section>

<section class="r" style="animation-delay:.45s">
<h2>The other half</h2>
<p><a href="https://deadchannel.vercel.app">deadchannel</a> grades any x402 endpoint before an agent spends money on it &mdash; alive, honestly priced, safe to call, or not. Built because we needed it ourselves while probing the catalog.</p>
</section>

<footer class="r" style="animation-delay:.54s">
Source <a href="https://github.com/plus8bit/deadchannel">github.com/plus8bit/deadchannel</a> &middot; zero runtime dependencies &middot; MIT<br>
Machine-readable card at <a href="${cfg.publicUrl}/index.json">/index.json</a> &middot; descriptors at <a href="${cfg.publicUrl}/llms.txt">/llms.txt</a>
</footer>

</div></body></html>`;
}
