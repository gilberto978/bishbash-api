import fetch from "node-fetch";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const query = (req.query.query || "").trim();
  if (!query) return res.status(400).json({ error: "Missing query term" });

  // Helper: call Bing API with given endpoint
  async function fetchBing(endpoint) {
    const q = `${query} scam fraud complaints reviews site:trustpilot.com OR site:reddit.com OR site:bbb.org OR site:scambook.com`;
    const url = `https://api.bing.microsoft.com/v7.0/${endpoint}?q=${encodeURIComponent(q)}&count=8`;
    const resp = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": process.env.BING_API_KEY }
    });
    return resp;
  }

  try {
    // First try /search
    let resp = await fetchBing("search");
    if (resp.status === 401 || resp.status === 403) {
      // Fallback to /news/search
      resp = await fetchBing("news/search");
    }

    const data = await resp.json();
    if (!data.webPages?.value && !data.value) {
      return res.status(200).json({
        query,
        verdict: "No strong signals found",
        red_flags: [],
        reviews: [],
        sources: [],
        debug: data
      });
    }

    // Normalize results (webPages.value vs news.value)
    const results = data.webPages?.value || data.value || [];
    const red_flags = [];
    const reviews = [];
    const sources = [];

    results.forEach(r => {
      const title = r.name || r.title || "";
      const snippet = r.snippet || r.description || "";
      const url = r.url || r.webSearchUrl || "";
      sources.push({ title, url });
      const text = `${title} ${snippet}`.toLowerCase();
      if (text.includes("scam") || text.includes("fraud") || text.includes("complaint")) {
        red_flags.push(snippet || title);
      } else {
        reviews.push(snippet || title);
      }
    });

    res.status(200).json({
      query,
      verdict: red_flags.length > 0 ? "⚠️ Possible Scam" : "🟢 No Major Red Flags Found",
      red_flags: [...new Set(red_flags)],
      reviews: [...new Set(reviews)],
      sources: sources.slice(0, 10)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error fetching results", detail: e.message });
  }
}
