import fetch from "node-fetch";
const blacklist = require("./regulator_blacklist.json");
const trusted = require("./trusted_brokers.json");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  let query = (req.query.query || "").trim();
  if (!query) return res.status(400).json({ error: "Missing query term" });

  try {
    // Normalize domain
    if (!query.includes(".")) query = `${query.toLowerCase()}.com`;
    let domain;
    try {
      domain = new URL(`https://${query}`).hostname.replace("www.", "");
    } catch {
      domain = query.toLowerCase();
    }

    // 🔹 Step 1: Check blacklist first
    if (blacklist.domains.includes(domain)) {
      return res.status(200).json({
        domain,
        verdict: "🚨 High Risk",
        summary: `This domain (${domain}) appears on official regulator warning lists.`,
        sources: [
          { title: "FCA Warning List", url: "https://www.fca.org.uk/consumers/warning-list-search" },
          { title: "CySEC Warnings", url: "https://www.cysec.gov.cy/en-GB/entities/investment-firms/cyprus-investment-firms-cif/warnings/" },
          { title: "ASIC Warnings", url: "https://asic.gov.au/online-services/search-warning-list/" }
        ]
      });
    }

    // 🔹 Step 2: Check trusted brokers
    if (trusted.domains[domain]) {
      return res.status(200).json({
        domain,
        verdict: "✅ Trusted",
        summary: trusted.domains[domain],
        sources: [
          { title: "FCA Register", url: "https://register.fca.org.uk" },
          { title: "ASIC Licensees", url: "https://connectonline.asic.gov.au" },
          { title: "CySEC Entities", url: "https://www.cysec.gov.cy" }
        ]
      });
    }

    // 🔹 Step 3: If not blacklisted or trusted, use SerpAPI + GPT
    const q = `${domain} scam fraud complaints reviews site:trustpilot.com OR site:reddit.com OR site:bbb.org OR site:forexpeacearmy.com`;
    const serpUrl = `https://serpapi.com/search.json?engine=bing&q=${encodeURIComponent(q)}&api_key=${process.env.SERPAPI_KEY}`;
    const serpResp = await fetch(serpUrl);
    const serpData = await serpResp.json();

    if (!serpData.organic_results) {
      return res.status(200).json({
        domain,
        verdict: "⚠️ Caution",
        summary: "No meaningful evidence detected. Please verify with regulators directly.",
        sources: []
      });
    }

    const snippets = serpData.organic_results.slice(0, 5).map(r => r.snippet).join(" ");
    const sources = serpData.organic_results.slice(0, 10).map(r => ({
      title: r.title,
      url: r.link
    }));

    const openAiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are an independent scam analysis assistant. Weigh regulator credibility > user reviews > random forums."
          },
          {
            role: "user",
            content: `Domain: ${domain}\n\nEvidence:\n${snippets}\n\nTask:\nClassify this broker/website as one of: Trusted, Caution, High Risk.\nGive exactly 3 short bullet reasons (≤10 words each).`
          }
        ],
        max_tokens: 200,
        temperature: 0.3
      })
    });

    const aiData = await openAiResp.json();
    const aiMessage = aiData.choices?.[0]?.message?.content || "No AI analysis available.";

    let verdict = "⚠️ Caution";
    if (/high risk/i.test(aiMessage)) verdict = "🚨 High Risk";
    else if (/trusted/i.test(aiMessage)) verdict = "✅ Trusted";

    res.status(200).json({
      domain,
      verdict,
      summary: aiMessage,
      sources
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error fetching or summarizing results", detail: e.message });
  }
}
