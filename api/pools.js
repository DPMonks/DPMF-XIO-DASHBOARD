import {writeIndexerResponse} from "../server/vercelHandler.js";

export const maxDuration = 10;

export default async function handler(req, res) {
  await writeIndexerResponse(req, res, "pools");
}
