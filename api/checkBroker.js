import fetch from "node-fetch";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");  // allow all domains
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // quick reply to preflight
  }

  const broker = req.query.broker;
  if (!broker) {
    return res.status(400).json({ error: "Missing broker name" });
  }

  try {
    const response = await fetch(
      `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(
        broker + " broker scam OR warning OR regulator"
      )}`,
      {
        headers: {
          "Ocp-Apim-Subscription-Key": process.env.BING_API_KEY,
        },
      }
    );

    const data = await response.json();

    let verdict = "GREEN";
    let color = "green";
    const snippet = data.webPages?.value?.[0]?.snippet || "No major issues found.";
    if (/scam|ban|warning|unlicensed/i.test(snippet)) {
      verdict = "RED";
      color = "red";
    }

    res.status(200).json({
      name: broker,
      verdict,
      color,
      snippet,
      source: data.webPages?.value?.[0]?.url || "N/A",
    });
  } catch (err) {
    res.status(500).json({ error: "Error fetching broker info" });
  }
}
