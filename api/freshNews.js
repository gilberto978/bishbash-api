import fetch from "node-fetch";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const topic = (req.query.topic || "").trim();
  if (!topic) return res.status(400).json({ error: "Missing topic" });

  try {
    // 🔹 Bing News Search (freshness = 24h)
    const q = `${topic}`;
    const url = `https://api.bing.microsoft.com/v7.0/news/search?q=${encodeURIComponent(q)}&freshness=Day&count=8`;
    
    const response = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": process.env.BING_API_KEY },
    });
    if (!response.ok) throw new Error("Bing fetch failed");

    const data = await response.json();
    const results = data.value || [];

    const headlines = results.map(item => ({
      title: item.name,
      snippet: item.description || "",
      source: item.provider?.[0]?.name || "Unknown",
      url: item.url,
      timestamp: item.datePublished
    }));

    const out = {
      topic,
      date: new Date().toISOString().split("T")[0],
      headlines: headlines.slice(0, 5),
      summary: "AI summary not enabled yet (coming soon)."
    };

    res.status(200).json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Error fetching news" });
  }
}
