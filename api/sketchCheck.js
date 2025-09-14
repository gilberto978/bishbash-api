import trustedDealers from "./trusted_watch_dealers.js";
import scamBlacklist from "./scammer_blacklist.js";

/** ---------------- utils ---------------- */
const norm = (s) => s.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "");
const onlyHost = (s) => norm(s).split("/")[0];

function fetchWithTimeout(url, { timeoutMs = 8000, ...opts } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function safeJson(res) {
  try { return await res.json(); }
  catch { return { error: "Invalid JSON from upstream" }; }
}

function tldOf(host) {
  const parts = host.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function domainHeuristics(host) {
  const tld = tldOf(host);
  const riskyTLDs = new Set(["xyz","top","live","shop","icu","fun","rest","oneg","link","online","work","click","tokyo","study","best","kim","monster","lol"]);
  const length = host.length;
  const hyphens = (host.match(/-/g) || []).length;
  const numbers = (host.match(/[0-9]/g) || []).length;
  const spammy = /(deal|discount|cheap|replica|sale|outlet|factory|authenticwatch|superclone|clone|wholesale|market|garantee|officialstore|watches?store)/i.test(host);

  const tldRisk = riskyTLDs.has(tld) ? 1 : 0;
  const longDomain = length >= 22 ? 1 : 0;
  const manyHyphens = hyphens >= 2 ? 1 : 0;
  const hasNumbers = numbers >= 2 ? 1 : 0;
  const spamWord = spammy ? 1 : 0;

  const riskSignals = [
    tldRisk && `TLD .${tld} is often abused`,
    longDomain && "Very long domain name",
    manyHyphens && "Multiple hyphens in domain",
    hasNumbers && "Numbers present in domain",
    spamWord && "Spammy sales/replica wording",
  ].filter(Boolean);

  // Risk score (0–100). Higher = riskier.
  let risk = 0;
  risk += tldRisk * 25;
  risk += longDomain * 15;
  risk += manyHyphens * 15;
  risk += hasNumbers * 10;
  risk += spamWord * 35;
  risk = Math.min(100, risk);

  return { tld, length, hyphens, numbers, spammy, risk, riskSignals };
}

function scoreToVerdict(trustScore) {
  if (trustScore >= 80) return "trusted";
  if (trustScore >= 50) return "caution";
  return "suspicious";
}

/** ---------------- handler ---------------- */
export default async function handler(req, res) {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: "Missing query parameter" });

    const host = onlyHost(query);

    /** 1) Hard signals: trusted & blacklist */
    const trustedHit = trustedDealers.find((d) => onlyHost(d.domain) === host);
    if (trustedHit) {
      return res.status(200).json({
        query: host,
        verdict: "trusted",
        trustScore: 95,
        reasons: [
          `✅ ${trustedHit.name} is a verified dealer`,
          trustedHit.info,
        ],
        sources: [{ label: trustedHit.name, url: `https://${trustedHit.domain}` }],
        lastChecked: new Date().toISOString(),
      });
    }

    const scamHit = scamBlacklist.find((d) => onlyHost(d.domain) === host);
    if (scamHit) {
      return res.status(200).json({
        query: host,
        verdict: "scam",
        trustScore: 5,
        reasons: [
          `🚨 Listed on ${scamHit.source}`,
          scamHit.reason,
        ],
        sources: [{ label: scamHit.source, url: scamHit.url || "#", date: scamHit.date }],
        lastChecked: new Date().toISOString(),
      });
    }

    /** 2) Domain heuristics (no external deps) */
    const heur = domainHeuristics(host);

    /** 3) Reddit chatter (timeout + fallback) */
    let redditPosts = [];
    try {
      const r = await fetchWithTimeout(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(host)}&limit=3`,
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
    } catch { /* ignore */ }

    const sources = redditPosts.length
      ? redditPosts
      : [{ label: "No Reddit discussions found", url: "#", date: new Date().toISOString() }];

    /** 4) Trust score (start from 60, subtract heuristics risk) */
    let trustScore = Math.max(5, Math.min(95, 60 - Math.round(heur.risk * 0.6)));
    // If there IS Reddit chatter with obvious negatives, nudge down a bit (light heuristic)
    const negHit = redditPosts.find(p => /scam|avoid|fake|fraud|ripoff/i.test(p.label));
    if (negHit) trustScore = Math.max(5, trustScore - 15);

    const verdict = scoreToVerdict(trustScore);

    /** 5) Reasons (succinct) */
    const reasons = [];
    reasons.push("⚠️ Not in trusted dealer index");
    reasons.push("⚠️ Not flagged in blacklist");
    if (heur.riskSignals.length) reasons.push(...heur.riskSignals.map(s => `⚠️ ${s}`));
    if (redditPosts.length) reasons.push("ℹ️ Community chatter found on Reddit");
    else reasons.push("ℹ️ No community reports found");

    return res.status(200).json({
      query: host,
      verdict,
      trustScore,
      reasons,
      signals: {
        tld: heur.tld,
        domainLength: heur.length,
        hyphens: heur.hyphens,
        numbers: heur.numbers,
        spammyWordsDetected: heur.spammy,
      },
      sources,
      lastChecked: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
