import fetch from "node-fetch";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const query = (req.query.query || "").trim();
  if (!query) return res.status(400).json({ error: "Missing query term" });

  try {
    // 🔹 Query Bing for scam/fraud signals
    const q = `${query} scam fraud complaints reviews site:trustpilot.com OR site:reddit.com OR site:scambook.com`;
    const resp = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}&count=10`,
      { headers: { "Ocp-Apim-Subscription-Key": process.env.BING_API_KEY } }
    );
    if (!resp.ok) throw new Error("Bing fetch failed");
    const data = await resp.json();

    const results = data.webPages?.value || [];
    const red_flags = [];
    const reviews = [];
    const sources = [];

    results.forEach(r => {
      const title = r.name || "";
      const snippet = r.snippet || "";
      const url = r.url || "";
      sources.push({ title, url });
      const text = `${title} ${snippet}`.toLowerCase();

      if (text.includes("scam") || text.includes("fraud") || text.includes("complaint")) {
        red_flags.push(snippet || title);
      } else {
        reviews.push(snippet || title);
      }
    });

    const out = {
      query,
      verdict: red_flags.length > 0 ? "⚠️ Possible Scam" : "🟢 No Major Red Flags Found",
      red_flags: [...new Set(red_flags)],
      reviews: [...new Set(reviews)],
      sources: sources.slice(0, 10)
    };

    res.status(200).json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error fetching results" });
  }
}
