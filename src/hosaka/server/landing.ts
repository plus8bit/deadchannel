import { PRICE_LOOKUP, PRICE_DOSSIER } from "./routes.ts";
import { TIERS } from "./bundle.ts";
import type { Config } from "../../server/config.ts";

/**
 * The page a person gets at the root, where an agent gets JSON.
 *
 * Both arrive at the same URL wanting opposite things. An agent needs the
 * machine-readable card; a person following a link needs to want to stay.
 * Serving one of them raw JSON is how a live shop looks abandoned.
 *
 * The whole page is built as a Hosaka deck jacked into the matrix, because the
 * shop is named after Gibson's Japanese computer. It opens the way the novel
 * does — a sky the colour of a dead channel — so the loading state is literal
 * static that dissolves into a cyberspace grid. Everything else is restraint:
 * one accent colour, one drifting grid, one rotating object, and evidence that
 * decrypts as it scrolls into view. Effects are decoration over a page that
 * reads fine without them, and every one of them stops under
 * prefers-reduced-motion.
 */
/**
 * A hanko — the vermillion seal a Japanese company stamps on paper it stands
 * behind — with the shuriken from the hero cut out of it.
 *
 * Drawn rather than lettered on purpose. A katakana glyph rendered by hand at
 * favicon size is a good way to publish a character that is subtly wrong to
 * anyone who reads Japanese, and a browser tab is not the place to find that
 * out. The star is unambiguous at sixteen pixels and already belongs to the
 * page.
 */
export const HOSAKA_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<defs><mask id="m">
  <rect width="32" height="32" fill="#fff"/>
  <path d="M16 4.5 L19.4 12.6 L27.5 16 L19.4 19.4 L16 27.5 L12.6 19.4 L4.5 16 L12.6 12.6 Z" fill="#000"/>
  <circle cx="16" cy="16" r="2.6" fill="#fff"/>
  <circle cx="16" cy="16" r="1.1" fill="#000"/>
</mask></defs>
<rect width="32" height="32" rx="7" fill="#FF3B2F" mask="url(#m)"/>
</svg>`;

export function hosakaLanding(cfg: Config): string {
  const chains = cfg.algorandPayTo ? "BASE / ALGORAND" : cfg.network.label.toUpperCase();
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Hosaka — company data for agents</title>
<meta name="description" content="Every third-party vendor a company can be proven to use, read from its own DNS. Sold to AI agents per call in USDC. No signup, no API key.">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<meta name="theme-color" content="#07080B">
<meta property="og:title" content="Hosaka — company data for agents">
<meta property="og:description" content="Every third-party vendor a company can be proven to use, read from its own DNS. Paid per call in USDC.">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap">
<!--
  the sky above the port was the color of television, tuned to a dead channel.
  you found the comments. try typing: jack in
-->
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --void:#07080B; --panel:#0C0E13; --panel2:#101319; --line:#191D26;
  --bone:#D7DAE0; --dim:#7B828E; --faint:#454B56;
  --seal:#FF3B2F; --jade:#43D9A3; --matrix:#2F6BFF;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --disp:"Chakra Petch",system-ui,sans-serif;
  --pad:clamp(18px,5vw,26px);
}
html{background:var(--void);-webkit-text-size-adjust:100%}
body{background:var(--void);color:var(--bone);font:15px/1.7 var(--mono);
  -webkit-font-smoothing:antialiased;overflow-x:hidden;position:relative}
body::after{content:"";position:fixed;inset:0;pointer-events:none;z-index:60;
  background:repeating-linear-gradient(180deg,rgba(255,255,255,.016) 0 1px,transparent 1px 3px)}

/* ── the matrix: a grid receding to a horizon, drifting ─────────────── */
.grid{position:fixed;left:0;right:0;bottom:0;height:56vh;z-index:0;pointer-events:none;
  perspective:300px;perspective-origin:50% 0;opacity:.75;
  /* Without this the rotated plane inside reaches past the viewport and widens
     the page, which on a phone pushes every line of text off the right edge. */
  overflow:hidden;
  mask-image:linear-gradient(to top,#000 4%,transparent 88%);
  -webkit-mask-image:linear-gradient(to top,#000 4%,transparent 88%)}
.grid i{position:absolute;left:-80%;right:-80%;top:0;height:340%;
  transform:rotateX(74deg);transform-origin:50% 0;
  background-image:
    linear-gradient(to right,rgba(47,107,255,.42) 1px,transparent 1px),
    linear-gradient(to bottom,rgba(47,107,255,.42) 1px,transparent 1px);
  background-size:56px 56px;animation:drift 7s linear infinite}
@keyframes drift{to{background-position:0 56px}}
body.jacked .grid{opacity:.95}
body.jacked .grid i{background-image:
  linear-gradient(to right,rgba(67,217,163,.42) 1px,transparent 1px),
  linear-gradient(to bottom,rgba(67,217,163,.42) 1px,transparent 1px);
  animation-duration:1.6s}

/* ── dead channel: the load state is static that dissolves ──────────── */
#static{position:fixed;inset:0;z-index:70;pointer-events:none;
  opacity:1;transition:opacity 1.05s ease-out}
#static.gone{opacity:0}

.wrap{max-width:900px;margin:0 auto;padding:clamp(48px,9vw,84px) var(--pad) 110px;
  position:relative;z-index:2}

@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.r{animation:rise .75s cubic-bezier(.2,.7,.3,1) both}

/* ── hero ───────────────────────────────────────────────────────────── */
header{position:relative}
.kana{position:absolute;right:-4px;top:clamp(-26px,-4vw,-14px);font-family:var(--disp);
  font-weight:700;font-size:clamp(64px,16vw,148px);line-height:1;color:#0F1219;
  letter-spacing:.04em;user-select:none;pointer-events:none;z-index:0;
  transition:color .5s}
body.jacked .kana{color:#132A22}
h1{position:relative;z-index:1;font-family:var(--disp);font-weight:700;
  font-size:clamp(40px,10vw,80px);line-height:.94;letter-spacing:-.02em}
h1 em{font-style:normal;color:var(--seal)}
/* Clicking it focuses the real prompt below, so the affordance tells the truth
   instead of blinking at a field that is not there. */
h1 .cur{color:var(--seal);animation:blink 1.15s steps(1) infinite;cursor:text}
@keyframes blink{50%{opacity:0}}
.rule{height:1px;margin:24px 0 22px;
  background:linear-gradient(90deg,var(--seal),var(--line) 40%,transparent)}
.tag{position:relative;z-index:1;color:var(--dim);max-width:62ch}
.tag b{color:var(--bone);font-weight:500}

/* the shuriken from the Ninsei window */
.shuri{position:absolute;right:2px;top:clamp(96px,26vw,168px);width:clamp(46px,11vw,74px);
  height:auto;opacity:.5;z-index:1;animation:spin 26s linear infinite;
  filter:drop-shadow(0 0 14px rgba(255,59,47,.25))}
@keyframes spin{to{transform:rotate(360deg)}}
/* On a phone it lands on top of a line of text, and a decoration that costs
   legibility is not worth keeping. */
@media(max-width:700px){.shuri{display:none}}

.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:30px;position:relative;z-index:1}
.chip{border:1px solid var(--line);background:var(--panel);padding:6px 12px;
  font-size:11px;letter-spacing:.09em;color:var(--dim);text-transform:uppercase;
  white-space:nowrap}
.chip i{font-style:normal;color:var(--jade)}
.chip b{color:var(--bone);font-weight:500}

/* A real, focusable prompt. The decorative caret in the headline read as an
   input, people clicked it, and nothing happened — an affordance that lies is
   worse than no affordance. */
#deck{margin-top:22px;max-width:min(100%,560px)}
#out{font-size:12.5px;line-height:1.65;max-height:0;overflow:hidden auto;
  transition:max-height .4s ease;color:var(--jade);
  border-left:1px solid transparent;padding-left:0}
#out.on{max-height:210px;border-left-color:var(--line);padding-left:13px;
  margin-bottom:10px}
#out .in{color:var(--faint)}
#out .k{color:var(--bone)}
#out .warn{color:var(--seal)}
.term{display:flex;align-items:center;gap:10px;padding:11px 14px;
  border:1px solid var(--line);background:var(--panel);
  transition:border-color .25s}
.term:focus-within{border-color:var(--seal)}
.term span{color:var(--seal);user-select:none}
.term input{flex:1;min-width:0;background:none;border:0;outline:0;color:var(--bone);
  font:14px/1 var(--mono);caret-color:var(--seal)}
.term input::placeholder{color:#3C424C}

.code{position:relative}
.code button{position:absolute;top:8px;right:8px;z-index:2;
  border:1px solid var(--line);background:var(--panel2);color:var(--dim);
  font:10.5px/1 var(--mono);letter-spacing:.1em;padding:6px 9px;cursor:pointer;
  transition:.2s;text-transform:uppercase}
.code button:hover{color:var(--bone);border-color:var(--faint)}
.code button.done{color:var(--jade);border-color:var(--jade)}
.code pre{padding-right:84px}

h2{font-family:var(--disp);font-weight:600;font-size:12px;letter-spacing:.24em;
  text-transform:uppercase;color:var(--seal);margin:clamp(46px,9vw,68px) 0 20px;
  display:flex;align-items:center;gap:14px}
h2::after{content:"";flex:1;height:1px;background:var(--line)}
p{color:var(--dim);max-width:68ch;margin-bottom:14px}
p strong{color:var(--bone);font-weight:500}

/* ── evidence, decrypting as it arrives ─────────────────────────────── */
.proof{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));
  gap:1px;background:var(--line);border:1px solid var(--line);margin:4px 0 20px}
.p{background:var(--panel);padding:14px 16px;transition:background .3s,box-shadow .3s;
  position:relative;overflow:hidden}
.p::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;
  background:var(--seal);transform:scaleY(0);transform-origin:top;transition:transform .3s}
.p:hover{background:var(--panel2)}
.p:hover::before{transform:scaleY(1)}
.p b{font-family:var(--disp);font-weight:600;font-size:15px;letter-spacing:.01em;color:var(--bone)}
.p code{display:block;color:var(--faint);font-size:11px;margin-top:6px;
  word-break:break-all;line-height:1.55}

table{border-collapse:collapse;width:100%;font-size:13.5px}
td{padding:12px 14px 12px 0;border-bottom:1px solid var(--line);vertical-align:top;color:var(--dim)}
td:first-child{color:var(--bone);white-space:nowrap;width:1%;padding-right:22px}
td.n{color:var(--seal);font-weight:700;text-align:right;width:1%;white-space:nowrap;font-size:14px}
tr{transition:background .2s}
tr:hover td{background:var(--panel)}
/* Absolute positioning let the price escape the row on narrow screens. A flex
   row cannot: the label and the price share one line and the description sits
   under both, so nothing can land outside the container. */
@media(max-width:620px){
  table,tbody{display:block;width:auto}
  tr{display:grid;grid-template-columns:1fr auto;gap:2px 12px;
     border-bottom:1px solid var(--line);padding:13px 0}
  td{display:block;border:0;padding:0;min-width:0}
  /* Placed explicitly. Auto-placement put the price on its own third row,
     because the full-width description forces a new row before it. */
  td:first-child{grid-area:1/1;padding-right:0;white-space:nowrap}
  td.n{grid-area:1/2;text-align:right;align-self:start}
  td:nth-child(2){grid-area:2/1/3/3;color:var(--dim)}
}

pre{background:var(--panel);border:1px solid var(--line);border-left:2px solid var(--seal);
  padding:15px 16px;overflow-x:auto;font-size:12.5px;line-height:1.75;color:var(--bone);
  -webkit-overflow-scrolling:touch}
pre .c{color:var(--faint)}
pre .s{color:var(--jade)}

a{color:var(--bone);text-decoration:none;border-bottom:1px solid var(--faint);transition:.2s}
a:hover{color:var(--seal);border-bottom-color:var(--seal)}
footer{margin-top:clamp(52px,10vw,76px);padding-top:24px;border-top:1px solid var(--line);
  color:var(--faint);font-size:12px;line-height:1.9}
.hint{margin-top:14px;color:#2C313A;font-size:11px;letter-spacing:.06em}
/* The easter egg used to answer in the footer, which nobody has on screen when
   they are typing at the top of the page. */


@media(prefers-reduced-motion:reduce){
  .r,.grid i,.shuri,h1 .cur{animation:none!important}
  #static{display:none}
}
</style></head><body>

<canvas id="static" aria-hidden="true"></canvas>
<div class="grid" aria-hidden="true"><i></i></div>

<div class="wrap">

<header class="r">
  <div class="kana" aria-hidden="true">ホサカ</div>
  <svg class="shuri" viewBox="0 0 100 100" aria-hidden="true" fill="none"
       stroke="var(--seal)" stroke-width="1.6" stroke-linejoin="round">
    <path d="M50 3 L61 39 L97 50 L61 61 L50 97 L39 61 L3 50 L39 39 Z"/>
    <path d="M50 22 L57 43 L78 50 L57 57 L50 78 L43 57 L22 50 L43 43 Z" opacity=".55"/>
    <circle cx="50" cy="50" r="6" opacity=".8"/>
  </svg>
  <h1>HOSAKA<em>.</em><span class="cur" aria-hidden="true">_</span></h1>
  <div class="rule"></div>
  <p class="tag">Company data for AI agents, paid per call in USDC. It reads a company's <b>own DNS</b> to find every third-party vendor it can be proven to use, and hands back the record that proves each one.</p>
  <div class="meta">
    <span class="chip"><i>&#9679;</i> LIVE &middot; ${chains}</span>
    <span class="chip">NO SIGNUP &middot; NO API KEY</span>
    <span class="chip">FROM <b>$${PRICE_LOOKUP}</b> A CALL</span>
    <span class="chip">OPEN SOURCE</span>
  </div>
  <div id="deck">
  <div id="out" aria-live="polite"></div>
  <div class="term">
    <span>&gt;</span>
    <input id="cmd" type="text" spellcheck="false" autocomplete="off"
           autocapitalize="off" autocorrect="off" placeholder="figma.com — or: jack in"
           aria-label="terminal — try a domain, or: jack in">
  </div>
  </div>
</header>

<section class="r" style="animation-delay:.10s">
<h2>The receipts are public</h2>
<p>A company proves it owns its domain to <strong>every SaaS product it buys</strong> by placing a verification record in DNS, and authorises every sender it uses in its SPF record. Those two lists are a purchase history the company published itself, sitting in the open, that nobody reads.</p>
<p>Ask for <strong>figma.com</strong>:</p>
<div class="proof">
  <div class="p"><b>Anthropic</b><code data-dec>TXT anthropic-domain-verification-4rt01s=&hellip;</code></div>
  <div class="p"><b>OpenAI</b><code data-dec>TXT openai-domain-verification=dv-JGOTRvDBX9eV2Gk8&hellip;</code></div>
  <div class="p"><b>Greenhouse</b><code data-dec>SPF include:mg-spf.greenhouse.io</code></div>
  <div class="p"><b>Zendesk</b><code data-dec>SPF include:mail.zendesk.com</code></div>
  <div class="p"><b>Docusign</b><code data-dec>TXT docusign=f6914af5-107a-4dfa-9793-e34a09f627f0</code></div>
  <div class="p"><b>Atlassian</b><code data-dec>TXT atlassian-domain-verification=oDxpYa6fakpgoav&hellip;</code></div>
</div>
<p>Seventeen vendors for that one domain, each with its evidence, so a buyer can <strong>check rather than trust</strong>. Page fingerprints require a loaded script or CDN host, never a mention: a site listing a vendor's logo among its integrations is not a site that uses it.</p>
</section>

<section class="r" style="animation-delay:.16s">
<h2>Shelves</h2>
<table><tbody>
<tr><td>POST /lookup</td><td>domain age, registrar, mail and DNS provider, DMARC, HTTPS, vendor count</td><td class="n">$${PRICE_LOOKUP}</td></tr>
<tr><td>POST /contacts</td><td>the dossier, plus the emails and phones the company publishes about itself</td><td class="n">$${TIERS.contacts.priceUsd}</td></tr>
<tr><td>POST /dossier</td><td>every vendor the company can be proven to use, each with its evidence</td><td class="n">$${PRICE_DOSSIER}</td></tr>
<tr><td>POST /people</td><td>the dossier, plus named people who work there</td><td class="n">$${TIERS.people.priceUsd}</td></tr>
</tbody></table>
<p style="margin-top:18px">Four prices, so a cheap question never pays for an expensive answer.</p>
</section>

<section class="r" style="animation-delay:.22s">
<h2>Use it</h2>
<pre><span class="c"># any x402 client; the 402 carries the price and terms</span>
curl -X POST <span class="s">${cfg.publicUrl}/dossier</span> \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"domain":"figma.com"}'</span></pre>
<p style="margin-top:16px">Or let an agent find it alone. Published to npm and listed in the official MCP registry, so any MCP client discovers and pays for it with one line:</p>
<pre>npx -y <span class="s">hosaka-mcp</span></pre>
</section>

<section class="r" style="animation-delay:.28s">
<h2>The expensive shelves are resale</h2>
<p>Contacts and people cannot be produced from public records, so we buy them &mdash; from another x402 seller, <strong>in the same call</strong>, only once an order arrives. No inventory, no contract, no subscription. The supply chain is machines paying machines.</p>
<p>Every supplier carries a ceiling, so we refuse to buy above what we charge, and the wallet is checked before the purchase rather than after: a shop that finds out it is broke halfway through an order has already taken the buyer's money and has nothing to hand back.</p>
</section>

<section class="r" style="animation-delay:.34s">
<h2>Countermeasures</h2>
<p><a href="https://deadchannel.vercel.app">deadchannel</a> grades any x402 endpoint before an agent spends money on it &mdash; alive, honestly priced, safe to call, or a trap. Built because we needed it ourselves while probing the catalog, and named for the first line of the book this shop is named after.</p>
</section>

<footer class="r" style="animation-delay:.40s">
Source <a href="https://github.com/plus8bit/deadchannel">github.com/plus8bit/deadchannel</a> &middot; zero runtime dependencies &middot; MIT<br>
Machine-readable card at <a href="${cfg.publicUrl}/index.json">/index.json</a> &middot; descriptors at <a href="${cfg.publicUrl}/llms.txt">/llms.txt</a>
<div class="hint">ONO-SENDAI CYBERSPACE 7 &middot; THE PROMPT TAKES A DOMAIN, OR <b style="color:#6B7280">HELP</b></div>
</footer>

</div>

<script>
(function(){
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* the sky above the port: static that dissolves into the grid */
  var cv = document.getElementById("static");
  function dropStatic(){ if (cv && cv.parentNode) cv.remove(); }
  if (cv && !reduce) {
    try {
      var ctx = cv.getContext("2d");
      // Never zero: a viewport measured before layout settles produced a
      // zero-width buffer, createImageData threw, and the noise froze opaque.
      var W = Math.max(1, Math.ceil((innerWidth || 320) / 3));
      var H = Math.max(1, Math.ceil((innerHeight || 480) / 3));
      cv.width = W; cv.height = H;
      cv.style.width = "100%"; cv.style.height = "100%";
      var img = ctx.createImageData(W, H), t0 = 0;
      var frame = function(ts){
        try {
          if (!t0) t0 = ts;
          var d = img.data;
          for (var i = 0; i < d.length; i += 4){
            var v = (Math.random()*255)|0;
            d[i] = d[i+1] = d[i+2] = v; d[i+3] = 26;
          }
          ctx.putImageData(img, 0, 0);
          if (ts - t0 < 900) requestAnimationFrame(frame);
          else { cv.classList.add("gone"); setTimeout(dropStatic, 1100); }
        } catch (e) { dropStatic(); }
      };
      requestAnimationFrame(frame);
      // Whatever happens, the overlay is gone well before it could sit on the
      // page looking like a failed load.
      setTimeout(function(){ cv.classList.add("gone"); setTimeout(dropStatic, 1100); }, 2600);
    } catch (e) { dropStatic(); }
  } else { dropStatic(); }

  /* evidence decrypts as it scrolls in */
  var CHARS = "ABCDEF0123456789abcdef=-.:/";
  function decrypt(el){
    var real = el.textContent, n = real.length, step = 0;
    var id = setInterval(function(){
      step++;
      var out = "";
      for (var i = 0; i < n; i++){
        if (i < step*1.6) out += real[i];
        else out += CHARS[(Math.random()*CHARS.length)|0];
      }
      el.textContent = out;
      if (step*1.6 >= n){ clearInterval(id); el.textContent = real; }
    }, 26);
  }
  var codes = [].slice.call(document.querySelectorAll("[data-dec]"));
  if (!reduce && "IntersectionObserver" in window){
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if (e.isIntersecting){ io.unobserve(e.target); decrypt(e.target); }
      });
    }, { threshold: .35 });
    codes.forEach(function(c){ io.observe(c); });
  }

  /* ── the deck ─────────────────────────────────────────────────────── */
  var out = document.getElementById("out");
  var cmd = document.getElementById("cmd");
  var busy = false;

  function write(text, cls){
    var d = document.createElement("div");
    if (cls) d.className = cls;
    out.classList.add("on");
    out.appendChild(d);
    while (out.children.length > 40) out.removeChild(out.firstChild);
    return new Promise(function(done){
      if (reduce){ d.textContent = text; out.scrollTop = out.scrollHeight; return done(); }
      // Driven by frames rather than a timer: a background tab throttles
      // setInterval to one tick a second, which turned typing into a crawl.
      // Frames pause instead, and the speed stays the same on every machine
      // because the character count comes from elapsed time, not tick count.
      var t0 = 0;
      (function step(ts){
        if (!t0) t0 = ts || 0;
        var n = Math.min(text.length, Math.floor(((ts || 0) - t0) / 1000 * 110));
        d.textContent = text.slice(0, n);
        out.scrollTop = out.scrollHeight;
        if (n < text.length) requestAnimationFrame(step); else done();
      })(0);
    });
  }
  function pause(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function short(a){ return a.length > 20 ? a.slice(0, 10) + "\u2026" + a.slice(-6) : a; }

  var LORE = {
    "jack in": ["jacking in\u2026",
      "cyberspace. a consensual hallucination experienced daily",
      "by billions of legitimate operators, in every nation."],
    "wintermute": ["wintermute. cold and silence, a cybernetic spider",
      "patiently spinning webs of Ice."],
    "dixie": ["the flatline: \u2018hey, bro.\u2019",
      "a construct that laughs without breathing."],
    "zion": ["zion cluster. built by workers who refused to go home.",
      "dub playing, always."],
    "case": ["case. twenty-four, a cowboy, and burned by mycotoxin.",
      "they damaged his nervous system with a wartime russian toxin."],
    "help": ["type a domain to see its live payment terms, or one of:",
      "jack in \u00b7 wintermute \u00b7 dixie \u00b7 zion \u00b7 case"]
  };

  /* A domain, loosely: has a dot, no spaces, no scheme. Good enough to decide
     whether to ask the server, and the server decides properly. */
  function looksLikeDomain(v){
    return v.indexOf(".") > 0 && v.indexOf(" ") === -1 && v.indexOf("/") === -1 && v.length < 80;
  }

  /* The real 402, fetched without paying. This is the whole protocol in one
     screen: an agent asks, the server answers with terms, nothing settles. */
  async function quote(domain){
    await write("probing " + location.host + "/lookup \u2026");
    var res, req;
    try {
      res = await fetch("/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: domain })
      });
      req = JSON.parse(atob(res.headers.get("payment-required") || ""));
    } catch (e) {
      await write("no answer. the deck is cold.", "warn");
      return;
    }
    await write(res.status + " " + (req.error || "payment required"), "k");
    var list = req.accepts || [];
    for (var i = 0; i < list.length; i++){
      var a = list[i];
      // "eip155" is a namespace, not a chain anyone recognises.
      var id = String(a.network || "");
      var net = id.indexOf("algorand:") === 0 ? "algorand"
              : id.indexOf("solana:") === 0 ? "solana"
              : id === "eip155:8453" ? "base"
              : id === "eip155:84532" ? "base-sep"
              : id.split(":")[0];
      var usd = (Number(a.amount) / 1e6).toFixed(3);
      await write("  " + (net + "        ").slice(0, 9) + "$" + usd + "  asset " + short(String(a.asset)));
    }
    await write("  payTo    " + short(String((list[0] || {}).payTo || "")));
    await pause(120);
    await write("nothing was charged. this is what an agent reads first.");
  }

  async function run(raw){
    if (busy) return;
    var v = raw.toLowerCase().trim();
    if (!v) return;
    busy = true;
    cmd.value = "";
    await write("> " + raw, "in");
    if (LORE[v]){
      if (v === "jack in") document.body.classList.toggle("jacked");
      for (var i = 0; i < LORE[v].length; i++) await write(LORE[v][i]);
    } else if (looksLikeDomain(v)) {
      await quote(v);
    } else {
      await write("no such construct. try a domain, or: help", "warn");
    }
    busy = false;
    cmd.focus();
  }

  var cur = document.querySelector("h1 .cur");
  if (cur && cmd) cur.addEventListener("click", function(){ cmd.focus(); });
  if (cmd){
    cmd.addEventListener("keydown", function(e){
      if (e.key === "Enter"){ e.preventDefault(); run(cmd.value); }
    });
    /* the lore words fire as soon as they are complete, no Enter needed */
    cmd.addEventListener("input", function(){
      var v = cmd.value.toLowerCase().trim();
      if (LORE[v] && v !== "help") run(cmd.value);
    });
  }

  /* copy buttons on every code block */
  [].slice.call(document.querySelectorAll("pre")).forEach(function(pre){
    var box = document.createElement("div");
    box.className = "code";
    pre.parentNode.insertBefore(box, pre);
    box.appendChild(pre);
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = "copy";
    b.setAttribute("aria-label", "copy to clipboard");
    b.addEventListener("click", function(){
      // No regex here on purpose: an escape sequence inside this template
      // literal becomes a real line break in the served script, which broke
      // the pattern and took the whole page's JavaScript down with it.
      var text = pre.innerText.trim();
      var done = function(){
        b.textContent = "copied"; b.classList.add("done");
        setTimeout(function(){ b.textContent = "copy"; b.classList.remove("done"); }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(done, function(){ fallback(text, done); });
      } else fallback(text, done);
    });
    box.appendChild(b);
  });
  function fallback(text, done){
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch (e) {}
    ta.remove();
  }

  if (window.console && console.log) {
    console.log("%cThe sky above the port was the color of television, tuned to a dead channel.",
      "color:#FF3B2F;font:600 13px ui-monospace,monospace");
    console.log("%chosaka · company data for agents · npx -y hosaka-mcp",
      "color:#43D9A3;font:12px ui-monospace,monospace");
  }
})();
</script>
</body></html>`;
}
