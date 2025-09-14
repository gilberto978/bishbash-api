import trustedDealers from "./trusted_watch_dealers.js";
import scamBlacklist from "./scammer_blacklist.js";

/** ---------- small utils ---------- */
const norm = (s) => s.toLowerCase().trim().replace(/^www\./, "");

function fetchWithTimeout(url, { timeoutMs = 8000, ...opts } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

async function safeJson(res) {
  try { return await res.json(); }
  catch { return { error: "Invalid JSON from upstream" }; }
}

function extractCreationDate(whoisData) {
  if (!whoisData) return null;
  const paths = [
    whoisData?.registration?.created,
    whoisData?.created_date,
    whoisData?.creation_date,
    whoisData?.created,
    whoisData?.registry_data?.created_date,
    whoisData?.registry_data?.creation_date,
  ];
  // ISO strings
  for (const v of paths) {
    if (typeof v === "string") {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
  }
  // numeric (epoch seconds or ms)
  for (const v of paths) {
    if (typeof v === "number") {
      const ms = v < 10_000_000_000 ? v * 1000 : v;
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}
const extractRegistrar = (w) =>
  w?.registrar?.name || w?.registrar || w?.registry_data?.registrar_name || "Unknown";

/** ---------- main handler ---------- */
export default async function handler(req, res) {
  try {
    // Health check & fast mode for quick debugging
    if (req.query.health === "1") {
      return res.status(200).json({ ok: true, now: new Date().toISOString() });
    }

    const { query, fast } = req.query;
    if (!query) return res.status(400).json({ error: "Missing query parameter" });

    const q = norm(query);

    // 1) Trusted
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

    // 2) Blacklist
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

    // If fast=1, skip external calls — proves the function returns immediately
    if (fast === "1") {
      return res.status(200).json({
        query: q,
        verdict: "suspicious",
        reasons: [
          "⚠️ Not in trusted dealer index",
          "⚠️ Not flagged in blacklist",
          "ℹ️ External checks skipped (fast mode)",
        ],
        sources: [{ label: "Fast mode", url: "#", date: new Date().toISOString() }],
        lastChecked: new Date().toISOString(),
      });
    }

    // 3) Suspicious → WHOIS (Apilayer) + Reddit with timeouts
    let whoisInfo = null;
    let domainAgeReason = "ℹ️ Domain age unavailable";
    const apiKey = process.env.APILAYER_API_KEY;

    if (!apiKey) {
      domainAgeReason = "ℹ️ WHOIS disabled (missing APILAYER_API_KEY)";
    } else {
      try {
        const whoisRes = await fetchWithTimeout(
          `https://api.apilayer.com/whois/query?domain=${encodeURIComponent(q)}`,
          { timeoutMs: 8000, headers: { apikey: apiKey } }
        );
        const whoisData = await safeJson(whoisRes);

        if (whoisRes.ok) {
          const created = extractCreationDate(whoisData);
          if (created) {
            const ageDays = Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24));
            domainAgeReason =
              ageDays < 90
                ? `⚠️ Domain registered ${ageDays} days ago — very recent (possible throwaway scam site).`
                : `ℹ️ Domain registered ${created.getFullYear()} (${ageDays} days old).`;
            whoisInfo = { created: created.toISOString(), registrar: extractRegistrar(whoisData) };
          } else if (whoisData?.error?.message) {
            domainAgeReason = `ℹ️ WHOIS unavailable: ${whoisData.error.message}`;
          }
        } else {
          domainAgeReason = `ℹ️ WHOIS unavailable (HTTP ${whoisRes.status})`;
        }
      } catch (err) {
        domainAgeReason = `ℹ️ WHOIS request failed: ${err.message}`;
      }
    }

    // Reddit (also with timeout)
    let redditPosts = [];
    try {
      const r = await fetchWithTimeout(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=2`,
        { timeoutMs: 6000, headers: { "User-Agent": "bishbash-scam-checker" } }
      );
      const data = await safeJson(r);
      if (data?.data?.children?.length) {
        redditPosts = data.data.children.map((c) => ({
          label: `Reddit: ${c.data.subreddit} — ${c.data.title}`,
          url: `https://reddit.com${c.data.permalink}`,
          date: new Date(c.data.created_utc * 1000).toISOString(),
        }));
      }
    } catch {
      // ignore; we fallback below
    }

    const sources = redditPosts.length
      ? redditPosts
      : [{ label: "No Reddit discussions found", url: "#", date: new Date().toISOString() }];

    // Simple trust meter
    let trustSignal = "🤔 Neutral — no strong community signals found.";
    if (domainAgeReason.includes("very recent")) trustSignal = "🚨 High Risk — brand new domain with no reputation.";
    else if (redditPosts.length) trustSignal = "🟡 Mixed — established domain but community review needed.";

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
