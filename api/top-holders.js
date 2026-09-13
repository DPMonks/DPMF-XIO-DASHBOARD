import {writeIndexerResponse} from "../server/vercelHandler.js";

export const maxDuration = 20;

export default async function handler(req, res) {
  await writeIndexerResponse(req, res, "top-holders");
}
