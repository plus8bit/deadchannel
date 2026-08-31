import { runPreview } from "./src/hosaka/server/routes.ts";
const DOMAINS = `outboundrepublic.com hook-agency.com accelerateb2b.com reachly.co salesbread.com belkins.io
saleshive.com leadium.com outboundview.com memoryblue.com sopro.io cleverly.co martal.ca cience.com
levelupleads.io unboundb2b.com outreachbloom.com salesroads.com leadgenius.com lotiva.com callboxinc.com
pearllemon.com reply.io lemlist.com smartlead.ai instantly.ai woodpecker.co close.com apollo.io hunter.io`.split(/\s+/).filter(Boolean);
const out = [];
let i = 0;
async function worker() {
  while (i < DOMAINS.length) {
    const d = DOMAINS[i++];
    try {
      const p = await runPreview({ domain: d });
      out.push({ domain: d, ...p });
    } catch (e) {
      out.push({ domain: d, error: String(e).slice(0, 80) });
    }
  }
}
await Promise.all([...Array(6)].map(worker));
out.sort((a, b) => DOMAINS.indexOf(a.domain) - DOMAINS.indexOf(b.domain));
console.log(JSON.stringify(out, null, 1));
