export default async function handler(req, res) {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: "Missing query parameter" });
    }

    const q = query.toLowerCase().trim().replace(/^www\./, "");

    let whoisInfo = null;
    let domainAgeReason = "ℹ️ Domain age unavailable";

    try {
      const whoisRes = await fetch(
        `https://api.api-ninjas.com/v1/whois?domain=${q}`,
        { headers: { "X-Api-Key": process.env.NINJAS_API_KEY } }
      );

      console.log("WHOIS status:", whoisRes.status);
      const whoisData = await whoisRes.json();
      console.log("WHOIS response:", whoisData);

      if (whoisData && (whoisData.creation_date || whoisData.creationDate)) {
        const created = new Date(
          whoisData.creation_date || whoisData.creationDate
        );
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
    } catch (err) {
      console.error("WHOIS API error:", err);
    }

    return res.status(200).json({
      query: q,
      domainAgeReason,
      whois: whoisInfo,
      lastChecked: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
