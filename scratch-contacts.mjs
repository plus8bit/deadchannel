const DOMAINS = `outboundrepublic.com hook-agency.com accelerateb2b.com reachly.co salesbread.com belkins.io
saleshive.com leadium.com outboundview.com memoryblue.com sopro.io cleverly.co martal.ca cience.com
levelupleads.io unboundb2b.com outreachbloom.com salesroads.com leadgenius.com lotiva.com callboxinc.com
pearllemon.com reply.io lemlist.com smartlead.ai instantly.ai woodpecker.co close.com apollo.io hunter.io`
  .split(/\s+/).filter(Boolean);

const PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/team"];
const RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JUNK = /\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i;

async function grab(url) {
  const c = AbortSignal.timeout(12000);
  try {
    const r = await fetch(url, { signal: c, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; hosaka-contact-check)" } });
    if (!r.ok) return "";
    return (await r.text()).slice(0, 400000);
  } catch { return ""; }
}

async function forDomain(d) {
  const found = new Map();
  let form = "";
  for (const p of PATHS) {
    const html = await grab(`https://${d}${p}`);
    if (!html) continue;
    if (!form && /<form/i.test(html) && /contact/i.test(p)) form = `https://${d}${p}`;
    for (const m of html.match(RE) ?? []) {
      const e = m.toLowerCase();
      if (JUNK.test(e)) continue;
      if (/(sentry|wixpress|example|domain\.com|yourdomain|@2x)/.test(e)) continue;
      found.set(e, (found.get(e) ?? 0) + 1);
    }
    if (found.size >= 3) break;
  }
  const own = [...found.keys()].filter((e) => e.endsWith("@" + d) || e.endsWith("." + d));
  const other = [...found.keys()].filter((e) => !own.includes(e));
  return { domain: d, own, other: other.slice(0, 3), form };
}

const out = [];
let i = 0;
async function w() { while (i < DOMAINS.length) { const d = DOMAINS[i++]; out.push(await forDomain(d)); } }
await Promise.all([...Array(5)].map(w));
out.sort((a, b) => DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(b.domain));
console.log(JSON.stringify(out, null, 1));
