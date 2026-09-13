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
