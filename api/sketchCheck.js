import * as dealersFile from "../data/datatrusted_watch_dealers.js";

const trustedDealers = dealersFile.default;

export default function handler(req, res) {
  try {
    console.log("DEBUG trustedDealers:", trustedDealers);

    return res.status(200).json({
      message: "API is working",
      trustedDealers: trustedDealers || null,
    });
  } catch (err) {
    console.error("Handler error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
