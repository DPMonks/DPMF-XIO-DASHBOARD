import {useEffect, useRef} from "react";
import {isClassicAddress} from "./xamanClient";
import {applyXappBootClass, isXappHost, notifyXappReady, readXappLaunch, rememberXappHost, resolveXappOtt, stripXappSearchParams} from "./xappHost";
import {ottAccount, ottStyle} from "./ottAccount";

export function useXappSession(connectWallet, onSettled) {
  const connectRef = useRef(connectWallet);
  const settledRef = useRef(onSettled);

  useEffect(() => {
    connectRef.current = connectWallet;
    settledRef.current = onSettled;
  }, [connectWallet, onSettled]);

  useEffect(() => {
    const launch = readXappLaunch();
    if (launch.token || isXappHost()) {
      rememberXappHost(true, launch.style);
      applyXappBootClass();
    }
    if (!launch.token) {
      if (isXappHost()) notifyXappReady();
      settledRef.current?.();
      return undefined;
    }

    // OTT is one-time. Do not cancel the resolve on remount (React Strict Mode)
    // and do not fetch it twice.
    let finished = false;
    resolveXappOtt(launch.token)
      .then((data) => {
        const account = ottAccount(data);
        rememberXappHost(true, ottStyle(data, launch.style));
        applyXappBootClass();
        if (account && isClassicAddress(account)) connectRef.current?.(account);
        stripXappSearchParams();
        notifyXappReady();
      })
      .catch(() => {
        rememberXappHost(true, launch.style);
        stripXappSearchParams();
        notifyXappReady();
      })
      .finally(() => {
        if (finished) return;
        finished = true;
        settledRef.current?.();
      });
    return undefined;
  }, []);
}
