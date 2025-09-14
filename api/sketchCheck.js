import trustedDealers from "./trusted_watch_dealers.js";
import scamBlacklist from "./scammer_blacklist.js";

/** ---------- small utils ---------- */
const norm = (s) => s.toLowerCase().trim().replace(/^www\./, "");

function fetchWithTimeout(url, { timeoutMs = 15000, ...opts } = {}) {
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
  for (const v of paths) {
    if (typeof v === "string") {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
  }
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
    const { query } = req.query;
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

    // 3) Suspicious → WHOIS (Apilayer)
    let whoisInfo = null;
    let domainAgeReason = "ℹ️ Domain age unavailable";
    const apiKey = process.env.APILAYER_API_KEY;

    if (!apiKey) {
      domainAgeReason = "ℹ️ WHOIS disabled (missing APILAYER_API_KEY)";
    } else {
      let whoisData = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const whoisRes = await fetchWithTimeout(
            `https://api.apilayer.com/whois/query?domain=${encodeURIComponent(q)}`,
            { timeoutMs: 15000, headers: { apikey: apiKey } }
          );
          if (whoisRes.ok) {
            whoisData = await safeJson(whoisRes);
            break;
          }
        } catch (err) {
          if (attempt === 1) {
            domainAgeReason = `ℹ️ WHOIS request failed after retries: ${err.message}`;
          }
        }
      }

      if (whoisData) {
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
      }
    }

    return res.status(200).json({
      query: q,
      verdict: "suspicious",
      reasons: [
        "⚠️ Not in trusted dealer index",
        "⚠️ Not flagged in blacklist",
        domainAgeReason,
      ],
      whois: whoisInfo,
      lastChecked: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
