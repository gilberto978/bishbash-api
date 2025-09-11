import fetch from "node-fetch";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const broker = req.query.broker;
  if (!broker) return res.status(400).json({ error: "Missing broker name" });

  try {
    const q = `${broker} broker reviews regulation Trustpilot license warning complaints fraud unauthorized banned`;
    const response = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}`,
      { headers: { "Ocp-Apim-Subscription-Key": process.env.BING_API_KEY } }
    );
    const data = await response.json();
    const results = data.webPages?.value?.slice(0, 15) || [];

    // Expanded keyword buckets
    const regulationKW = ["fca","cysec","asic","cftc","nfa","fsca","bafin","finma","mas","license","regulated","authorised","authorized","regulator","compliance"];
    const reviewKW    = ["trustpilot","review","rating","forexbrokers","daytrading","traders union","forex peace army","reddit","feedback"];
    const redKW       = ["scam","fraud","complaints","warning","unauthorized","unauthorised","blacklist","revoked","unlicensed","ban","banned","not regulated"];

    const regulation = [];
    const reviews = [];
    const red_flags = [];
    const sources = [];

    for (const r of results) {
      const text = `${r.name} ${r.snippet}`.toLowerCase();
      sources.push(r.url);
      if (regulationKW.some(k => text.includes(k))) regulation.push(r.snippet || r.name);
      if (reviewKW.some(k => text.includes(k)))     reviews.push(r.snippet || r.name);
      if (redKW.some(k => text.includes(k)))        red_flags.push(r.snippet || r.name);
    }

    // Dedup + trim
    const dedup = arr => Array.from(new Set(arr)).slice(0, 8);
    const out = {
      name: broker,
      regulation: dedup(regulation),
      reviews: dedup(reviews),
      red_flags: dedup(red_flags),
      sources: dedup(sources),
      verdict: "TRUSTED",
      color: "green"
    };

    // Verdict logic (brutally honest)
    if (out.red_flags.length > 0) {
      out.verdict = "HIGH RISK";
      out.color = "red";
    } else if (out.regulation.length === 0 && out.reviews.length === 0) {
      out.verdict = "CAUTION";
      out.color = "amber";
      out.reviews.push("No regulator or review evidence in top 15 results. Verify directly with official registries (FCA, CySEC, ASIC). Treat with caution.");
    }

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: "Error fetching broker info" });
  }
}
