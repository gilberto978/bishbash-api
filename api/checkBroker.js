import fetch from "node-fetch";

/* ---------- Helpers ---------- */
const UA = { "User-Agent": "Mozilla/5.0 (BishBash.ai MVP; +https://bishbash.ai)" };
const ok = r => r && (r.status === 200);
const textLower = s => (s || "").toLowerCase();

/* ---------- FCA: quick register check ---------- */
/* Strategy: hit FCA search page and look for “Authorised/Authorized” or “Unauthorised/Warning”.
   URL pattern: https://register.fca.org.uk/s/search?q=<query>
*/
async function fcaCheck(name) {
  try {
    const url = `https://register.fca.org.uk/s/search?q=${encodeURIComponent(name)}`;
    const r = await fetch(url, { headers: UA, timeout: 12000 });
    if (!ok(r)) return { status: "unknown" };
    const html = await r.text();
    const tl = textLower(html);

    // Heuristics (MVP): look for strings that commonly appear around firm tiles
    const authorised = tl.includes("authorised") || tl.includes("authorized");
    const unauthorised = tl.includes("unauthorised") || tl.includes("unauthorized");
    const warning = tl.includes("warning") && tl.includes("firm");

    if (unauthorised || warning) return { status: "warning", url };
    if (authorised) return { status: "authorised", url };
    return { status: "unknown", url };
  } catch {
    return { status: "error" };
  }
}

/* ---------- CySEC: warning scan via site search ---------- */
/* Strategy: search CySEC site for the name + warning.
   (We use Bing but scoped to the regulator’s domain to surface official notices.)
*/
async function cysecCheck(name, bingKey) {
  try {
    const q = `${name} warning site:cysec.gov.cy`;
    const resp = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}`,
      { headers: { "Ocp-Apim-Subscription-Key": bingKey, ...UA }, timeout: 12000 }
    );
    if (!ok(resp)) return { status: "unknown" };
    const data = await resp.json();
    const items = data.webPages?.value || [];
    const urls = items.map(v => v.url);
    const combined = items.map(v => `${v.name} ${v.snippet}`).join(" ").toLowerCase();

    const hit = combined.includes("warning") || combined.includes("unauthorised") || combined.includes("unauthorized");
    if (hit) return { status: "warning", urls };
    return { status: "unknown", urls };
  } catch {
    return { status: "error" };
  }
}

/* ---------- Main handler ---------- */
export default async function handler(req, res) {
  // CORS for Uncody
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const broker = (req.query.broker || "").trim();
  if (!broker) return res.status(400).json({ error: "Missing broker name" });

  // 1) Instant overrides for demo-smoothness
  const WL = [
    "ig","ig index","ig markets","ig.com",
    "oanda","saxo","saxo bank","interactive brokers","ibkr",
    "pepperstone","cmc markets","city index","xtb","x_tb"
  ];
  const BL = [
    "24option","24 option","trustmarkets","banxso","xmarkets"
  ];
  const key = broker.toLowerCase();

  const baseOut = (verdict, color, note) => ({
    name: broker,
    regulation: [],
    reviews: note ? [note] : [],
    red_flags: [],
    sources: [],
    verdict,
    color
  });

  if (WL.includes(key)) {
    return res.status(200).json(baseOut(
      "TRUSTED","green","Recognized, long-established broker. Verify entity & license number by region."
    ));
  }
  if (BL.includes(key)) {
    const out = baseOut("HIGH RISK","red","Broker frequently cited in complaints/blacklists. Proceed with extreme caution.");
    out.red_flags.push("Listed in community reports / watchdog sites.");
    return res.status(200).json(out);
  }

  try {
    // 2) Run regulator checks in parallel
    const [fca, cysec] = await Promise.all([
      fcaCheck(broker),
      cysecCheck(broker, process.env.BING_API_KEY)
    ]);

    const regSignals = [];
    const redSignals = [];
    const regSources = [];

    if (fca.url) regSources.push({ title: "FCA Register Search", url: fca.url });
    if (fca.status === "authorised") regSignals.push("FCA: Authorised (match found on register)");
    if (fca.status === "warning") redSignals.push("FCA: Possible warning/unauthorised signal on register");

    if (cysec.urls && cysec.urls.length) {
      regSources.push(...cysec.urls.slice(0,3).map(u => ({ title: "CySEC (warning search)", url: u })));
    }
    if (cysec.status === "warning") redSignals.push("CySEC: Warning likely (see links)");

    // 3) If any regulator warning → RED; if authorised → GREEN (unless warning too)
    let verdict = "TRUSTED";
    let color = "green";

    if (redSignals.length > 0) { verdict = "HIGH RISK"; color = "red"; }
    else if (regSignals.length > 0) { verdict = "TRUSTED"; color = "green"; }

    // 4) Fallback to Bing aggregation (your existing improved logic)
    const q = `${broker} broker reviews regulation Trustpilot license warning complaints fraud unauthorized banned "license revoked" FCA CySEC ASIC CFTC NFA`;
    const resp = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}`,
      { headers: { "Ocp-Apim-Subscription-Key": process.env.BING_API_KEY, ...UA }, timeout: 15000 }
    );
    const data = await resp.json();
    const results = data.webPages?.value?.slice(0, 20) || [];

    const regulationKW = ["fca","cysec","asic","cftc","nfa","fsca","bafin","finma","mas","license","licence","regulated","authorised","authorized","register","regulator","compliance","authorisation","authorization"];
    const reviewKW    = ["trustpilot","review","rating","forexbrokers","daytrading","traders union","forex peace army","reddit","feedback","complaints board","sitejabber"];
    const redKW       = ["scam","fraud","warning","unauthorized","unauthorised","blacklist","revoked","unlicensed","ban","banned","not regulated","report a scam","victim","chargeback"];

    const regulation = [...regSignals];
    const reviews = [];
    const red_flags = [...redSignals];
    const sources = [...regSources];

    for (const r of results) {
      const title = r.name || "";
      const snippet = r.snippet || "";
      const url = r.url || "";
      const text = `${title} ${snippet}`.toLowerCase();
      sources.push({ title, url });

      if (regulationKW.some(k => text.includes(k))) regulation.push(snippet || title);
      if (reviewKW.some(k => text.includes(k)))     reviews.push(snippet || title);
      if (redKW.some(k => text.includes(k)))        red_flags.push(snippet || title);
    }

    // dedup & trim
    const dedup = arr => Array.from(new Set(arr.filter(Boolean))).slice(0, 8);
    const dedupSources = arr => {
      const seen = new Set(); const out = [];
      for (const s of arr) {
        if (!s.url || seen.has(s.url)) continue;
        seen.add(s.url); out.push(s);
        if (out.length >= 10) break;
      }
      return out;
    };

    const out = {
      name: broker,
      regulation: dedup(regulation),
      reviews: dedup(reviews),
      red_flags: dedup(red_flags),
      sources: dedupSources(sources),
      verdict,
      color
    };

    // Final verdict guardrails
    if (out.red_flags.length > 0) { out.verdict = "HIGH RISK"; out.color = "red"; }
    else if (out.regulation.length === 0 && out.reviews.length === 0) {
      out.verdict = "CAUTION"; out.color = "amber";
      out.reviews.push("No clear regulator or review evidence found in top results. Verify directly on official registers (FCA, CySEC, ASIC). Treat with caution.");
    }

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "Error fetching broker info" });
  }
}
