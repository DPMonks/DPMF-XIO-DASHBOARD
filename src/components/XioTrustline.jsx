import {useWallet} from "../context/useWallet";
import {xioTrustSetTxjson} from "../constants/ledger";
import {useXamanPayload} from "../xaman/useXamanPayload";
import {useI18n} from "../i18n/useI18n";
import WalletButton from "./WalletButton";
import WalletModal from "./WalletModal";

export default function XioTrustline() {
  const { t } = useI18n();
  const { walletAddress, connectWallet } = useWallet();
  const { qr, mobileUrl, uuid, status, error, start, reset } = useXamanPayload();

  function startTrustline() {
    start({
      body: { txjson: xioTrustSetTxjson(walletAddress) },
      onSigned: (account) => {
        if (account) connectWallet(account);
      },
      errorMessage: t.trustlineError,
    });
  }

  return (
    <div className="wallet-control">
      <WalletButton
        onClick={startTrustline}
        disabled={status === "loading" || status === "waiting"}
        label={t.xioTrustline}
        title={t.xioTrustlineHint}
      />
      {error && <p className="wallet-error">{error}</p>}
      <WalletModal
        visible={status === "loading" || status === "waiting"}
        qrUrl={qr}
        mobileUrl={mobileUrl}
        uuid={uuid}
        status={status}
        preparingLabel={t.preparingTrustline}
        scanLabel={t.scanTrustline}
        onClose={reset}
      />
    </div>
  );
}
