import * as dealersFile from "../data/datatrusted_watch_dealers.js";
import * as blacklistFile from "../data/scammer_blacklist.js";

const trustedDealers = dealersFile.default;   // unwrap array
const scamBlacklist = blacklistFile.default;  // unwrap array

export default async function handler(req, res) {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Missing query parameter" });
    }

    // Normalize input
    const q = query.toLowerCase().trim().replace(/^www\./, "");

    // Debug
    console.log("Trusted dealers loaded:", trustedDealers.map(d => d.domain));
    console.log("Query received:", q);

    // 1. Trusted check
    const trustedHit = Array.isArray(trustedDealers)
      ? trustedDealers.find(
          (d) => q === d.domain.toLowerCase().trim().replace(/^www\./, "")
        )
      : null;

    if (trustedHit) {
      return res.status(200).json({
        query: q,
        verdict: "trusted",
        reasons: [
          `✅ ${trustedHit.name} is a verified dealer`,
          trustedHit.info,
        ],
        sources: [
          { label: trustedHit.name, url: `https://${trustedHit.domain}` },
        ],
        lastChecked: new Date().toISOString(),
      });
    }

    // 2. Blacklist check
    const scamHit = Array.isArray(scamBlacklist)
      ? scamBlacklist.find(
          (d) => q === d.domain.toLowerCase().trim().replace(/^www\./, "")
        )
      : null;

    if (scamHit) {
      return res.status(200).json({
        query: q,
        verdict: "scam",
        reasons: [
          `🚨 Flagged as scam in ${scamHit.source}`,
          scamHit.reason,
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

    // 3. Suspicious fallback → Fetch Reddit posts
    let redditPosts = [];
    try {
      const redditRes = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=2`,
        { headers: { "User-Agent": "bishbash-scam-checker" } }
      );
      const redditData = await redditRes.json();

      if (
        redditData &&
        redditData.data &&
        Array.isArray(redditData.data.children)
      ) {
        redditPosts = redditData.data.children.map((c) => ({
          label: `Reddit: ${c.data.subreddit} — ${c.data.title}`,
          url: `https://reddit.com${c.data.permalink}`,
          date: new Date(c.data.created_utc * 1000).toISOString(),
        }));
      }
    } catch (err) {
      console.error("Reddit fetch error:", err);
    }

    return res.status(200).json({
      query: q,
      verdict: "suspicious",
      reasons: [
        "⚠️ Not in trusted dealer index",
        "⚠️ Not flagged in blacklist",
        "Further analysis required: domain age, pricing anomalies, reputation footprint",
      ],
      sources: redditPosts,
      lastChecked: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
