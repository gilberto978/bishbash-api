import fetch from "node-fetch";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const query = (req.query.query || "").trim();
  if (!query) return res.status(400).json({ error: "Missing query term" });

  try {
    // Use SerpAPI with Bing engine
    const q = `${query} scam fraud complaints reviews site:trustpilot.com OR site:reddit.com OR site:bbb.org`;
    const url = `https://serpapi.com/search.json?engine=bing&q=${encodeURIComponent(q)}&api_key=${process.env.SERPAPI_KEY}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (!data.organic_results) {
      return res.status(200).json({
        query,
        verdict: "No results found",
        red_flags: [],
        reviews: [],
        sources: [],
        debug: data
      });
    }

    const results = data.organic_results;
    const red_flags = [];
    const reviews = [];
    const sources = [];

    results.forEach(r => {
      const title = r.title || "";
      const snippet = r.snippet || "";
      const link = r.link || "";
      sources.push({ title, url: link });
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
