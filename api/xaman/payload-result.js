import {requestOrigin, xamanErrorMessage, xummHeaders} from "./_xumm.js";

export default async function handler(req, res) {
  const uuid = req.query?.uuid || new URL(req.url, "http://localhost").searchParams.get("uuid");
  if (!uuid) {
    res.status(400).json({ error: "Missing uuid" });
    return;
  }

  try {
    const origin = requestOrigin(req);
    const response = await fetch(
      `https://xumm.app/api/v1/platform/payload/${encodeURIComponent(uuid)}`,
      { headers: xummHeaders(origin) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json({
        error: xamanErrorMessage(data, "Failed to read Xaman payload"),
        code: data?.error?.code ?? data?.code ?? response.status,
      });
      return;
    }
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to read Xaman payload" });
  }
}
