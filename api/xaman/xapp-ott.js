import {requestOrigin, xamanErrorMessage, xummHeaders} from "./_xumm.js";
import {isXappOtt} from "../../src/xaman/xappHost.js";
import {ottAccount, ottStyle} from "../../src/xaman/ottAccount.js";

export function publicOttView(raw = {}) {
  const account = ottAccount(raw);
  return {
    account: account || null,
    style: ottStyle(raw) || null,
    nodetype: raw.nodetype || raw.node || null,
    source: "xaman",
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const token =
    req.query?.token || new URL(req.url, "http://localhost").searchParams.get("token") || "";
  if (!isXappOtt(token)) {
    res.status(400).json({ error: "Missing xApp token" });
    return;
  }

  try {
    const origin = requestOrigin(req);
    const response = await fetch(
      `https://xumm.app/api/v1/platform/xapp/ott/${encodeURIComponent(token)}`,
      { headers: xummHeaders(origin) }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.status(response.status).json({
        error: xamanErrorMessage(data, "Failed to read the Xaman xApp session"),
        code: data?.error?.code ?? data?.code ?? response.status,
      });
      return;
    }
    res.status(200).json(publicOttView(data));
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to read the Xaman xApp session" });
  }
}
