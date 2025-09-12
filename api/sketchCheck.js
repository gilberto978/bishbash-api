// /api/sketchCheck.js
// ESM imports — lists must be .js modules with `export default`
import blacklist from "./regulator_blacklist.js";
import trusted from "./trusted_brokers.js";

function normalizeDomain(input) {
  let s = (input || "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split(/[\/?#]/)[0];
  if (!s.includes(".")) s = `${s}.com`;
  return s;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default async function handler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    let query = (req.query.query || "").trim();
    if (!query) return res.status(400).json({ error: "Missing query term" });

    const domain = normalizeDomain(query);
    const blk = (blacklist.domains || []).map(d => normalizeDomain(d));
    const trd = trusted.domains || {};

    // 1) 🚨 Blacklist
    if (blk.includes(domain)) {
      return res.status(200).json({
        domain,
        verdict: "🚨 High Risk",
        summary: `This domain (${domain}) appears on regulator warning lists.`,
        threats: ["⚠️ Official regulator warnings — avoid completely."],
        sources: [
          { title: "FCA Warning List", url: "https://www.fca.org.uk/consumers/warning-list-search" },
          { title: "CySEC Warnings", url: "https://www.cysec.gov.cy/en-GB/entities/investment-firms/cyprus-investment-firms-cif/warnings/" },
          { title: "ASIC Warnings", url: "https://asic.gov.au/online-services/search-warning-list/" }
        ]
      });
    }

    // 2) ✅ Trusted
    if (Object.prototype.hasOwnProperty.call(trd, domain)) {
      return res.status(200).json({
        domain,
        verdict: "✅ Trusted",
        summary: trd[domain],
        threats: [],
        sources: [
          { title: "FCA Register", url: "https://register.fca.org.uk" },
          { title: "ASIC Licensees", url: "https://connectonline.asic.gov.au" },
          { title: "CySEC Entities", url: "https://www.cysec.gov.cy" }
        ]
      });
    }

    // 3) ⚠️ AI fallback
    const SERP = process.env.SERPAPI_KEY;
    const OAI  = process.env.OPENAI_API_KEY;
    if (!SERP) return res.status(500).json({ error: "Missing SERPAPI_KEY" });

    const q = `${domain} reviews complaints scam site:trustpilot.com OR site:reddit.com OR site:bbb.org OR site:forexpeacearmy.com`;
    const serpUrl = `https://serpapi.com/search.json?engine=bing&q=${encodeURIComponent(q)}&count=20&api_key=${SERP}`;

    const serpResp = await fetch(serpUrl);
    const serpData = await serpResp.json();
    const raw = Array.isArray(serpData.organic_results) ? serpData.organic_results : [];

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
      if (dropHosts.some(h => url.includes(h))) return false;
      return true;
    });

    const usable = filtered.length ? filtered : raw.slice(0, 5);
    const snippets = usable.slice(0, 6).map(r => r.snippet || "").join(" ");
    const sources  = usable.slice(0, 8).map(r => ({ title: r.title || "", url: r.link || "" }));

    if (!OAI) {
      return res.status(200).json({
        domain,
        verdict: "⚠️ Caution",
        summary: snippets ? "Review the broker-specific sources below." : "No direct evidence found. Verify with regulators.",
        threats: [],
        sources
      });
    }

    const trimmed = snippets.slice(0, 1200);

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
              "Use only evidence explicitly tied to the domain.\n" +
              "Verdict must be Trusted / Caution / High Risk.\n" +
              "Also highlight if evidence suggests impersonation, phishing, fake support, or withdrawal issues."
          },
          {
            role: "user",
            content:
              `Domain: ${domain}\nEvidence:\n${trimmed}\n\n` +
              "Output format:\n" +
              "Verdict line (Trusted, Caution, or High Risk)\n" +
              "Three short bullets with reasons."
          }
        ]
      })
    });

    const aiData = await aiResp.json();
    const msg = (aiData.choices?.[0]?.message?.content || "").trim();

    let verdict = "⚠️ Caution";
    if (/^high\s*risk/i.test(msg)) verdict = "🚨 High Risk";
    else if (/^trusted/i.test(msg)) verdict = "✅ Trusted";

    let summary = msg || "No direct evidence found.";
    let threats = [];

    // 🔎 Threat detectors
    if (/impersonat|phishing|fake support/i.test(summary)) {
      threats.push("⚠️ Brand frequently impersonated in phishing scams");
    }
    if (/withdrawal|payout|cannot withdraw|blocked funds/i.test(summary)) {
      threats.push("⚠️ Users report withdrawal / payout issues");
    }
    if (/unlicensed|not regulated|fake license/i.test(summary)) {
      threats.push("⚠️ Possible unlicensed or fake regulation claims");
    }

    return res.status(200).json({ domain, verdict, summary, threats, sources });

  } catch (e) {
    console.error("Unhandled error:", e);
    return res.status(500).json({ error: "Internal error", detail: e?.message || String(e) });
  }
}
