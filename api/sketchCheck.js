// /api/sketchCheck.js

import blacklist from "./regulator_blacklist.js";
import trusted from "./trusted_brokers.js";

export default async function handler(req, res) {
  try {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    // Input
    let query = (req.query.query || "").trim();
    if (!query) return res.status(400).json({ error: "Missing query term" });

    // Normalize to domain (lowercase, no www.)
    if (!query.includes(".")) query = `${query.toLowerCase()}.com`;
    let domain;
    try {
      domain = new URL(`https://${query}`).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      domain = query.toLowerCase().replace(/^www\./, "");
    }

    // Normalize blacklist + trusted
    const blacklistDomains = (blacklist.domains || []).map(d =>
      d.toLowerCase().replace(/^www\./, "")
    );
    const trustedDomains = trusted.domains || {};

    // 1) Regulator blacklist → High Risk
    if (blacklistDomains.includes(domain)) {
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

    // 2) Trusted brokers → Trusted
    if (Object.keys(trustedDomains).includes(domain)) {
      return res.status(200).json({
        domain,
        verdict: "✅ Trusted",
        summary: trustedDomains[domain],
        sources: [
          { title: "FCA Register", url: "https://register.fca.org.uk" },
          { title: "ASIC Licensees", url: "https://connectonline.asic.gov.au" },
          { title: "CySEC Entities", url: "https://www.cysec.gov.cy" }
        ]
      });
    }

    // 3) AI fallback (SerpAPI + OpenAI)
    const SERP = process.env.SERPAPI_KEY;
    const OAI = process.env.OPENAI_API_KEY;
    if (!SERP) return res.status(500).json({ error: "Missing SERPAPI_KEY" });

    const q = `${domain} scam fraud complaints reviews site:trustpilot.com OR site:reddit.com OR site:bbb.org OR site:forexpeacearmy.com`;
    const serpUrl = `https://serpapi.com/search.json?engine=bing&q=${encodeURIComponent(q)}&api_key=${SERP}`;
    const serpResp = await fetch(serpUrl);
    const serpData = await serpResp.json();

    const results = Array.isArray(serpData.organic_results) ? serpData.organic_results : [];
    const snippets = results.slice(0, 5).map(r => r.snippet || "").join(" ");
    const sources = results.slice(0, 10).map(r => ({ title: r.title || "", url: r.link || "" }));

    if (!OAI) {
      return res.status(200).json({
        domain,
        verdict: "⚠️ Caution",
        summary: "AI unavailable. Review sources below for context.",
        sources
      });
    }

    const aiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OAI}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Independent scam analysis. Prioritize regulator > user reviews > forums." },
          { role: "user", content: `Domain: ${domain}\n\nEvidence:\n${snippets}\n\nClassify as Trusted / Caution / High Risk.\nGive exactly 3 short bullets (≤10 words each).` }
        ],
        max_tokens: 200,
        temperature: 0.3
      })
    });

    const aiData = await aiResp.json();
    const msg = aiData.choices?.[0]?.message?.content || "";

    let verdict = "⚠️ Caution";
    if (/high risk/i.test(msg)) verdict = "🚨 High Risk";
    else if (/trusted/i.test(msg)) verdict = "✅ Trusted";

    return res.status(200).json({ domain, verdict, summary: msg, sources });

  } catch (e) {
    console.error("Unhandled error:", e);
    return res.status(500).json({ error: "Internal error", detail: e?.message || String(e) });
  }
}
