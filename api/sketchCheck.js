import fetch from "node-fetch";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const query = (req.query.query || "").trim();
  if (!query) return res.status(400).json({ error: "Missing query term" });

  try {
    const q = `${query} scam fraud complaints reviews site:trustpilot.com OR site:reddit.com OR site:bbb.org OR site:scambook.com`;
    const resp = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}&count=8`,
      { headers: { "Ocp-Apim-Subscription-Key": process.env.BING_API_KEY } }
    );
    const data = await resp.json();

    if (!data.webPages?.value) {
      return res.status(200).json({
        query,
        verdict: "No strong signals found",
        red_flags: [],
        reviews: [],
        sources: [],
        debug: data   // <- will help debug key issues
      });
    }

    const results = data.webPages.value;
    const red_flags = [];
    const reviews = [];
    const sources = [];

    results.forEach(r => {
      const text = `${r.name} ${r.snippet}`.toLowerCase();
      sources.push({ title: r.name, url: r.url });
      if (text.includes("scam") || text.includes("fraud") || text.includes("complaint")) {
        red_flags.push(r.snippet);
      } else {
        reviews.push(r.snippet);
      }
    });

    res.status(200).json({
      query,
      verdict: red_flags.length > 0 ? "⚠️ Possible Scam" : "🟢 No Major Red Flags Found",
      red_flags: [...new Set(red_flags)],
      reviews: [...new Set(reviews)],
      sources
    });
  } catch (e) {
    res.status(500).json({ error: "Error fetching results", detail: e.message });
  }
}
