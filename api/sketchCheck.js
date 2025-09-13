import trustedDealers from "./trusted_watch_dealers.js";
import scamBlacklist from "./scammer_blacklist.js";

/** Helpers */
const norm = (s) => s.toLowerCase().trim().replace(/^www\./, "");

/** Try hard to extract a creation date from various WHOIS shapes */
function extractCreationDate(whoisData) {
  if (!whoisData) return null;

  // Common Apilayer shapes
  const candidates = [
    whoisData?.registration?.created,          // preferred (ISO)
    whoisData?.created_date,                   // alt ISO
    whoisData?.creation_date,                  // alt ISO
    whoisData?.created,                        // alt ISO
    whoisData?.registry_data?.created_date,    // nested ISO
    whoisData?.registry_data?.creation_date,   // nested ISO
  ].filter(Boolean);

  // If we found an ISO-like string
  for (const v of candidates) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: numeric epoch seconds/millis anywhere obvious
  const numericCandidates = [
    whoisData?.registration?.created,
    whoisData?.created_date,
    whoisData?.creation_date,
    whoisData?.created,
    whoisData?.registry_data?.created_date,
    whoisData?.registry_data?.creation_date,
  ].filter((v) => typeof v === "number");

  for (const n of numericCandidates) {
    // if seconds, multiply to ms
    const ms = n < 10_000_000_000 ? n * 1000 : n;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function extractRegistrar(whoisData) {
  return (
    whoisData?.registrar?.name ||
    whoisData?.registrar ||
    whoisData?.registry_data?.registrar_name ||
    "Unknown"
  );
}

export default async function handler(req, res) {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: "Missing query parameter" });

    const q = norm(query);

    /** 1) Trusted */
    const trustedHit = trustedDealers.find((d) => q === norm(d.domain));
    if (trustedHit) {
      return res.status(200).json({
        query: q,
        verdict: "trusted",
        reasons: [
          `✅ ${trustedHit.name} is a verified dealer`,
          trustedHit.info,
        ],
        sources: [{ label: trustedHit.name, url: `https://${trustedHit.domain}` }],
        lastChecked: new Date().toISOString(),
      });
    }

    /** 2) Blacklist */
    const scamHit = scamBlacklist.find((d) => q === norm(d.domain));
    if (scamHit) {
      return res.status(200).json({
        query: q,
        verdict: "scam",
        reasons: [
          `🚨 Flagged as scam in ${scamHit.source}`,
          scamHit.reason,
        ],
        sources: [{ label: scamHit.source, url: scamHit.url || "#", date: scamHit.date }],
        lastChecked: new Date().toISOString(),
      });
    }

    /** 3) Suspicious → WHOIS (Apilayer) + Reddit + Trust meter */
    let whoisInfo = null;
    let domainAgeReason = "ℹ️ Domain age unavailable";

    try {
      const whoisRes = await fetch(
        `https://api.apilayer.com/whois/query?domain=${encodeURIComponent(q)}`,
        { headers: { apikey: process.env.APILAYER_API_KEY } }
      );

      // Gracefully handle errors/limits
      if (whoisRes.ok) {
        const whoisData = await whoisRes.json();

        const created = extractCreationDate(whoisData);
        if (created) {
          const ageDays = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
          domainAgeReason =
            ageDays < 90
              ? `⚠️ Domain registered ${ageDays} days ago — very recent (possible throwaway scam site).`
              : `ℹ️ Domain registered ${created.getFullYear()} (${ageDays} days old).`;

          whoisInfo = {
            created: created.toISOString(),
            registrar: extractRegistrar(whoisData),
          };
        } else if (whoisData?.error?.message) {
          domainAgeReason = `ℹ️ WHOIS unavailable: ${whoisData.error.message}`;
        }
      } else {
        // Non-200
        domainAgeReason = `ℹ️ WHOIS unavailable (HTTP ${whoisRes.status})`;
      }
    } catch (e) {
      // Network/other
      domainAgeReason = "ℹ️ WHOIS unavailable (request failed)";
    }

    // Reddit chatter
    let redditPosts = [];
    try {
      const r = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=2`,
        { headers: { "User-Agent": "bishbash-scam-checker" } }
      );
      const data = await r.json();
      if (data?.data?.children?.length) {
        redditPosts = data.data.children.map((c) => ({
          label: `Reddit: ${c.data.subreddit} — ${c.data.title}`,
          url: `https://reddit.com${c.data.permalink}`,
          date: new Date(c.data.created_utc * 1000).toISOString(),
        }));
      }
    } catch {
      /* ignore reddit failures; we fall back below */
    }

    const sources =
      redditPosts.length > 0
        ? redditPosts
        : [{ label: "No Reddit discussions found", url: "#", date: new Date().toISOString() }];

    // Trust meter
    let trustSignal = "🤔 Neutral — no strong community signals found.";
    if (domainAgeReason.includes("very recent")) trustSignal = "🚨 High Risk — brand new domain with no reputation.";
    else if (redditPosts.length > 0) trustSignal = "🟡 Mixed — established domain but community review needed.";

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
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
