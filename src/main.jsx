import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {WalletProvider} from "./context/WalletContext";
import {I18nProvider} from "./i18n/I18nContext";
import {installPlatformGuard} from "./security/platformGuard";
import {applyXappBootClass} from "./xaman/xappHost";
import "./index.css";

installPlatformGuard();
applyXappBootClass();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nProvider>
      <WalletProvider>
        <App />
      </WalletProvider>
    </I18nProvider>
  </React.StrictMode>
);

// Reload once if a stale deploy left lazy chunks missing (MIME/HTML 404 after hash change).
if (typeof window !== "undefined" && !window.__dpmfChunkReloadBound) {
  window.__dpmfChunkReloadBound = true;
  window.addEventListener("unhandledrejection", (event) => {
    const msg = String(event?.reason?.message || event?.reason || "");
    if (/Failed to fetch dynamically imported module|Loading chunk \d+ failed|Importing a module script failed/i.test(msg)) {
      const key = "dpmf_chunk_reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
      }
    }
  });
}
