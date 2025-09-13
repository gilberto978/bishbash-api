import trustedDealers from "./trusted_watch_dealers.js";
import scamBlacklist from "./scammer_blacklist.js";

export default async function handler(req, res) {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: "Missing query parameter" });
    }

    // Normalize input
    const q = query.toLowerCase().trim().replace(/^www\./, "");

    // 1. Trusted check
    const trustedHit = trustedDealers.find(
      (d) => q === d.domain.toLowerCase().trim().replace(/^www\./, "")
    );

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

    // 2. Scam check
    const scamHit = scamBlacklist.find(
      (d) => q === d.domain.toLowerCase().trim().replace(/^www\./, "")
    );

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

    // 3. Suspicious fallback → WHOIS API + Reddit
    let whoisInfo = null;
    let domainAgeReason = "ℹ️ Domain age unavailable";

    try {
      const whoisRes = await fetch(
        `https://api.api-ninjas.com/v1/whois?domain=${q}`,
        { headers: { "X-Api-Key": process.env.NINJAS_API_KEY } }
      );

      if (whoisRes.ok) {
        const whoisData = await whoisRes.json();
        if (whoisData && whoisData.creation_date) {
          const created = new Date(whoisData.creation_date);
          const now = new Date();
          const ageDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));

          if (ageDays < 90) {
            domainAgeReason = `⚠️ Domain registered ${ageDays} days ago — very recent (possible throwaway scam site).`;
          } else {
            domainAgeReason = `ℹ️ Domain registered ${created.getFullYear()} (${ageDays} days old).`;
          }

          whoisInfo = {
            created: created.toISOString(),
            registrar: whoisData.registrar || "Unknown",
          };
        }
      }
    } catch (err) {
      console.error("WHOIS API error:", err);
    }

    // Reddit fetch
    let redditPosts = [];
    try {
      const redditRes = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=2`,
        { headers: { "User-Agent": "bishbash-scam-checker" } }
      );
      const redditData = await redditRes.json();

      if (redditData?.data?.children?.length) {
        redditPosts = redditData.data.children.map((c) => ({
          label: `Reddit: ${c.data.subreddit} — ${c.data.title}`,
          url: `https://reddit.com${c.data.permalink}`,
          date: new Date(c.data.created_utc * 1000).toISOString(),
        }));
      }
    } catch (err) {
      console.error("Reddit fetch error:", err);
    }

    // Sources fallback
    const sources = redditPosts.length > 0
      ? redditPosts
      : [{ label: "No Reddit discussions found", url: "#", date: new Date().toISOString() }];

    // Trust signal meter
    let trustSignal = "🤔 Neutral — no strong community signals found.";
    if (domainAgeReason?.includes("very recent")) {
      trustSignal = "🚨 High Risk — brand new domain with no reputation.";
    } else if (redditPosts.length > 0) {
      trustSignal = "🟡 Mixed — established domain but community review needed.";
    }

    // Final suspicious verdict
    return res.status(200).json({
      query: q,
      verdict: "suspicious",
      reasons: [
        "⚠️ Not in trusted dealer index",
        "⚠️ Not flagged in blacklist",
        domainAgeReason,
        trustSignal,
      ],
      sources,
      whois: whoisInfo,
      lastChecked: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
