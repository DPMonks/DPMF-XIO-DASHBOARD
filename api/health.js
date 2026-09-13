import {writeIndexerResponse} from "../server/vercelHandler.js";

export const maxDuration = 10;

export default async function handler(req, res) {
  const pathOnly = String(req.url || "").split("?")[0];
  const suffix = pathOnly.includes("xrpl") ? "health/xrpl" : "health";
  await writeIndexerResponse(req, res, suffix);
}
