import fetch from "node-fetch";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const query = (req.query.query || "").trim();
  if (!query) return res.status(400).json({ error: "Missing query term" });

  try {
    // Step 1: Fetch results from SerpAPI (Bing)
    const q = `${query} scam fraud complaints reviews site:trustpilot.com OR site:reddit.com OR site:bbb.org OR site:forexpeacearmy.com`;
    const serpUrl = `https://serpapi.com/search.json?engine=bing&q=${encodeURIComponent(q)}&api_key=${process.env.SERPAPI_KEY}`;
    const serpResp = await fetch(serpUrl);
    const serpData = await serpResp.json();

    if (!serpData.organic_results) {
      return res.status(200).json({
        query,
        verdict: "⚠️ Caution",
        summary: "No meaningful evidence detected. Please verify with regulators directly.",
        sources: []
      });
    }

    // Step 2: Trim snippets for efficiency
    const snippets = serpData.organic_results.slice(0, 5).map(r => r.snippet).join(" ");
    const sources = serpData.organic_results.slice(0, 10).map(r => ({
      title: r.title,
      url: r.link
    }));

    // Step 3: Inject trusted broker context (for Tier-1 firms)
    const trustedBrokers = {
      "ig": "FCA regulated (UK), listed on London Stock Exchange, multiple Tier-1 regulators.",
      "interactive brokers": "SEC & CFTC regulated, NASDAQ listed, trusted globally.",
      "saxo": "Danish FSA regulated, well-established, European banking license.",
      "oanda": "CFTC, NFA, MAS regulated, long-standing forex broker."
    };

    const extraContext = Object.keys(trustedBrokers).find(b => query.toLowerCase().includes(b))
      ? trustedBrokers[query.toLowerCase()]
      : "";

    // Step 4: Call OpenAI for AI verdict
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
            content: "You are an independent scam analysis assistant. Weigh regulator credibility > user reviews > random blogs."
          },
          {
            role: "user",
            content: `Company: ${query}\n\nExtra Context: ${extraContext}\n\nEvidence:\n${snippets}\n\nClassify as one of: Trusted, Caution, High Risk.\nGive exactly 3 short bullet reasons (≤10 words each).`
          }
        ],
        max_tokens: 200,
        temperature: 0.3
      })
    });

    const aiData = await openAiResp.json();
    const aiMessage = aiData.choices?.[0]?.message?.content || "No AI analysis available.";

    // Step 5: Verdict extraction
    let verdict = "⚠️ Caution";
    if (/high risk/i.test(aiMessage)) verdict = "🚨 High Risk";
    else if (/trusted/i.test(aiMessage)) verdict = "✅ Trusted";

    res.status(200).json({
      query,
      verdict,
      summary: aiMessage,
      sources
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error fetching or summarizing results", detail: e.message });
  }
}
