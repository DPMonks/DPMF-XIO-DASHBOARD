import {xrplRpc} from "../../server/xrplBookOffers.js";

export default async function handler(req, res) {
  const hash = String(
    req.query?.hash || new URL(req.url, "http://localhost").searchParams.get("hash") || ""
  ).trim();
  if (!/^[A-Fa-f0-9]{64}$/.test(hash)) {
    res.status(400).json({ error: "Invalid transaction hash" });
    return;
  }

  try {
    const result = await xrplRpc("tx", { transaction: hash, binary: false });
    res.status(200).json(result || { found: false });
  } catch (error) {
    res.status(200).json({ found: false, error: error.message || "Ledger lookup failed" });
  }
}
