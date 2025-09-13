import trustedDealers from "../data/trusted_watch_dealers.js";
import scamBlacklist from "../data/scammer_blacklist.js";

export default function handler(req, res) {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Missing query parameter" });
    }

    const q = query.toLowerCase().trim();

    // 1. Trusted check
    const trustedHit = trustedDealers.find(
      (d) => d.domain.toLowerCase() === q
    );
    if (trustedHit) {
      return res.status(200).json({
        query: q,
        verdict: "trusted",
        reasons: [
          `Listed in trusted_watch_dealers.js as ${trustedHit.name}`,
          "Active dealer with long-standing reputation footprint",
        ],
        sources: [
          { label: trustedHit.name, url: `https://${trustedHit.domain}` },
        ],
        lastChecked: new Date().toISOString(),
      });
    }

    // 2. Blacklist check
    const scamHit = scamBlacklist.find(
      (d) => d.domain.toLowerCase() === q
    );
    if (scamHit) {
      return res.status(200).json({
        query: q,
        verdict: "scam",
        reasons: [
          `Blacklisted in ${scamHit.source}`,
          "Community reports of scam behavior",
        ],
        sources: [
          {
            label: scamHit.source,
            url: scamHit.url || "#",
            date: scamHit.date,
          },
        ],
        lastChecked: new Date().toISOString(),
      });
    }

    // 3. Suspicious fallback (AI analysis placeholder for now)
    return res.status(200).json({
      query: q,
      verdict: "suspicious",
      reasons: [
        "Not found in trusted dealers",
        "Not listed in blacklist",
        "Further AI analysis required (domain age, pricing anomalies, reputation footprint)",
      ],
      sources: [],
      lastChecked: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
