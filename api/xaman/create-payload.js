import {buildXamanPayload, isFreshXamanCreate, readJson, requestOrigin, xamanErrorMessage, xummConfigured, xummHeaders} from "./_xumm.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJson(req);
    const origin = requestOrigin(req);
    const response = await fetch("https://xumm.app/api/v1/platform/payload", {
      method: "POST",
      headers: xummHeaders(origin),
      body: JSON.stringify(buildXamanPayload(origin, body.txjson, body.options)),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && !isFreshXamanCreate(data)) {
      res.status(409).json({
        error: "Xaman returned a payload that was already signed. Start a new sign.",
        code: 409,
        configured: xummConfigured(),
      });
      return;
    }
    if (!response.ok) {
      res.status(response.status).json({
        error: xamanErrorMessage(data),
        code: data?.error?.code ?? data?.code ?? response.status,
        configured: xummConfigured(),
      });
      return;
    }
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to create Xaman payload" });
  }
}
