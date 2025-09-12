// ESM imports — lists must be .js modules with `export default`
import blacklist from "./regulator_blacklist.js";
import trusted from "./trusted_brokers.js";

function normalizeDomain(input) {
  // strip protocol + www + path/query/fragment
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  // cut at first slash, question, or hash
  s = s.split(/[\/?#]/)[0];
  // if no dot, assume .com
  if (!s.includes(".")) s = `${s}.com`;
  return s;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    // Input
    let query = (req.query.query || "").trim();
    if (!query) return res.status(400).json({ error: "Missing query term" });

    // Domain
    const domain = normalizeDomain(query);

    // Precompute normalized lists
    const blk = (blacklist.domains || []).map(d => normalizeDomain(d));
    const trd = trusted.domains || {};

    // 1) Blacklist → 🚨 High Risk
    if (blk.includes(domain)) {
      return res.status(200).json({
        domain,
        verdict: "🚨 High Risk",
        summary: `This domain (${domain}) appears on regulator warning lists.`,
        sources: [
          { title: "FCA Warning List", url: "https://www.fca.org.uk/consumers/warning-list-search" },
          { title: "CySEC Warnings", url: "https://www.cysec.gov.cy/en-GB/entities/investment-firms/cyprus-investment-firms-cif/warnings/" },
          { title: "ASIC Warnings", url: "https://asic.gov.au/online-services/search-warning-list/" }
        ]
      });
    }

    // 2) Trusted → ✅ Trusted
    if (Object.prototype.hasOwnProperty.call(trd, domain)) {
      return res.status(200).json({
        domain,
        verdict: "✅ Trusted",
        summary: trd[domain],
        sources: [
          { title: "FCA Register", url: "https://register.fca.org.uk" },
          { title: "ASIC Licensees", url: "https://connectonline.asic.gov.au" },
          { title: "CySEC Entities", url: "https://www.cysec.gov.cy" }
        ]
      });
    }

    // 3) Fallback: SerpAPI + AI
    const SERP = process.env.SERPAPI_KEY;
    const OAI  = process.env.OPENAI_API_KEY;
    if (!SERP) return res.status(500).json({ error: "Missing SERPAPI_KEY" });

    // Focus query on broker-specific evidence
    const q = `${domain} reviews complaints scam site:trustpilot.com OR site:reddit.com OR site:bbb.org OR site:forexpeacearmy.com`;
    const serpUrl = `https://serpapi.com/search.json?engine=bing&q=${encodeURIComponent(q)}&count=20&api_key=${SERP}`;

    const serpResp = await fetch(serpUrl);
    const serpData = await serpResp.json();
    const raw = Array.isArray(serpData.organic_results) ? serpData.organic_results : [];

    // Filter: keep only results that explicitly mention the domain
    const domRE = new RegExp(escapeRegex(domain), "i");
    const dropHosts = [
      "bbb.org/scamtracker", "bbb.org/lookupscam", "bbb.org/all/social-media-scams"
    ];

    const filtered = raw.filter(r => {
      const url = (r.link || "").toLowerCase();
      const title = (r.title || "").toLowerCase();
      const snip = (r.snippet || "").toLowerCase();
      const mentions = domRE.test(url) || domRE.test(title) || domRE.test(snip);
      if (!mentions) return false;
      if (dropHosts.some(h => url.includes(h))) return false; // remove generic BBB catch-alls
      return true;
    });

    // If we over-filtered, fall back to top few to avoid empty state
    const usable = filtered.length ? filtered : raw.slice(0, 5);

    const snippets = usable.slice(0, 6).map(r => r.snippet || "").join(" ");
    const sources  = usable.slice(0, 8).map(r => ({ title: r.title || "", url: r.link || "" }));

    // If no OpenAI, degrade gracefully
    if (!OAI) {
      return res.status(200).json({
        domain,
        verdict: "⚠️ Caution",
        summary: snippets ? "Review the broker-specific sources below." : "No direct evidence found. Verify with regulators.",
        sources
      });
    }

    // Trim snippets to keep tokens tight
    const trimmed = snippets.slice(0, 1200);

    // AI: strict instructions to ignore unrelated evidence
    const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OAI}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "You are an independent broker risk checker.\n" +
              "Only use evidence that explicitly mentions the exact domain.\n" +
              "Prioritize regulator evidence > large review platforms > forums.\n" +
              "If evidence is generic or unrelated, IGNORE it.\n" +
              "If no direct evidence remains, say: 'No direct evidence found.'"
          },
          {
            role: "user",
            content:
              `Domain: ${domain}\n` +
              `Relevant evidence (domain-matching only):\n${trimmed}\n\n` +
              "Classify as one: Trusted / Caution / High Risk.\n" +
              "Output EXACTLY:\n" +
              "Line 1: Verdict word only (Trusted, Caution, or High Risk)\n" +
              "Line 2-4: Three bullets (<=10 words) with reasons.\n" +
              "Do not mention unrelated sites. No disclaimers."
          }
        ]
      })
    });

    const aiData = await aiResp.json();
    const msg = (aiData.choices?.[0]?.message?.content || "").trim();

    // Parse verdict
    let verdict = "⚠️ Caution";
    if (/^high\s*risk/i.test(msg)) verdict = "🚨 High Risk";
    else if (/^trusted/i.test(msg)) verdict = "✅ Trusted";

    // If model reported no direct evidence, force Caution
    const summary = msg || "No direct evidence found. Verify with regulators.";
    if (/no direct evidence found/i.test(summary)) verdict = "⚠️ Caution";

    return res.status(200).json({ domain, verdict, summary, sources });

  } catch (e) {
    console.error("Unhandled error:", e);
    return res.status(500).json({ error: "Internal error", detail: e?.message || String(e) });
  }
}
