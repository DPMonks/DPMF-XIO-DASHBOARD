export function interfaceLinkState(link = {}, t = {}) {
  const blob = `${link.error || ""} ${link.hint || ""} ${link.database || ""}`;
  const authFailed =
    link.database === "auth-failed" ||
    /password authentication failed/i.test(blob);
  const live =
    link.status === "ok" ||
    link.health === "ok" ||
    link.source === "db" ||
    link.source === "postgres" ||
    link.database === "postgres";

  if (authFailed || link.status === "error") {
    return {
      tone: "offline",
      label: t.interfaceOffline || "Not connected",
    };
  }
  if (live && link.status !== "connecting") {
    return {
      tone: "online",
      label: t.interfaceOnline || "XIO interface online",
    };
  }
  return {
    tone: "connecting",
    label: t.interfaceConnecting || "Connecting to XIO Interface",
  };
}
