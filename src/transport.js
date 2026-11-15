// A document-relative route also works under a reverse-proxy mount.
export const ROUTE = "api/life-desk";

export function createRequest(send, t, route = ROUTE, timeoutMs = 15000) {
  return async function request(action, signal) {
    let response;
    try {
      response = await send(route, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new Error(t("backendTimeout"));
      }
      throw new Error(t("backendNetwork"));
    }

    const text = await response.text();
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      // A failed Host may return plain text or an HTML error page. Do not
      // expose the parser's misleading "Unexpected token" message.
    }
    if (!response.ok) {
      if (response.status === 404)
        throw new Error(t("backendMissing") + " (HTTP 404)");
      if (response.status === 401 || response.status === 403) {
        throw new Error(t("backendAccess") + ` (HTTP ${response.status})`);
      }
      throw new Error(
        typeof envelope?.error === "string"
          ? envelope.error
          : t("backendFailed") + ` (HTTP ${response.status})`,
      );
    }
    if (!envelope || typeof envelope.ok !== "boolean") {
      throw new Error(t("backendFormat"));
    }
    if (!envelope.ok) throw new Error(envelope.error || t("error"));
    return envelope.value;
  };
}
