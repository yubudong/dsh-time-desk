import * as React from "react";
import { SpiritIcon } from "./SpiritIcon";
import { createRequest } from "./transport.js";
const { useState, useEffect, useRef } = React;

export function createSpiritPanel({ send, t, refresh }: any) {
  const request = createRequest(send, t, "api/life-desk-spirit", 45000);
  return function SpiritPanel({
    open,
    onClose,
    reviewRequest,
    reducedMotion = false,
    onBusyChange = () => {},
  }: any) {
    const [view, setView] = useState<any>(null),
      [catalog, setCatalog] = useState<any>(null),
      [draft, setDraft] = useState(""),
      [error, setError] = useState(""),
      [pending, setPending] = useState(false),
      [attempt, setAttempt] = useState(0);
    const input = useRef<HTMLTextAreaElement>(null),
      end = useRef<HTMLDivElement>(null),
      requestId = useRef(crypto.randomUUID()),
      lastTool = useRef("");
    useEffect(() => {
      onBusyChange(pending || !!view?.busy);
    }, [pending, view?.busy]);
    const consumedReview = useRef("");
    useEffect(() => {
      if (
        !open ||
        !reviewRequest ||
        consumedReview.current === reviewRequest.id
      )
        return;
      consumedReview.current = reviewRequest.id;
      const context = reviewRequest;
      const prompt = `请帮我复盘 ${context.date}。请围绕这一天提问，协助整理复盘草稿；在我明确确认前，不保存复盘、不完成习惯打卡。\n复盘模板：\n${context.template}\n现有复盘内容（仅供参考）：\n${context.text || "（尚未填写）"}`;
      setDraft((existing) =>
        existing.trim() ? existing + "\n\n" + prompt : prompt,
      );
      requestId.current = crypto.randomUUID();
      input.current?.focus();
    }, [open, reviewRequest?.id]);
    const receive = (v: any) => {
      setView(v);
      const tool = v.messages
        ?.filter((r: any) => r.role === "operation" && r.state !== "running")
        .at(-1);
      const key = tool ? tool.id + tool.state : "";
      if (key && key !== lastTool.current) {
        lastTool.current = key;
        void refresh();
      }
    };
    useEffect(() => {
      if (!open) return;
      const controller = new AbortController();
      let active = true;
      setError("");
      void (async () => {
        try {
          const models = await request({ action: "models" }, controller.signal);
          if (!active) return;
          setCatalog(models);
          const initial = await request({ action: "open" }, controller.signal);
          if (!active) return;
          receive(initial);
          input.current?.focus();
          let version = initial.version;
          while (active) {
            const next = await request(
              { action: "watch", after: version },
              controller.signal,
            );
            if (!active) return;
            version = next.version;
            receive(next);
          }
        } catch (e) {
          if (active) setError(e.message);
        }
      })();
      return () => {
        active = false;
        controller.abort();
      };
    }, [open, attempt]);
    useEffect(() => {
      if (open) end.current?.scrollIntoView({ block: "nearest" });
    }, [view?.version, open]);
    async function command(a: any) {
      setError("");
      setPending(true);
      try {
        const value = await request(a);
        receive(value);
        return value;
      } catch (e) {
        setError(e.message);
        return null;
      } finally {
        setPending(false);
      }
    }
    async function submit(e?: any) {
      e?.preventDefault();
      if (!draft.trim() || pending || view?.busy) return;
      const result = await command({
        action: "send",
        text: draft,
        requestId: requestId.current,
      });
      if (result) {
        setDraft("");
        requestId.current = crypto.randomUUID();
        input.current?.focus();
      }
    }
    if (!open) return null;
    const value = view?.selection
      ? JSON.stringify({
          provider: view.selection.provider,
          model: view.selection.model,
        })
      : "follow";
    const selected = view?.selection || catalog?.default;
    const modelLabel = selected ? selected.provider + "/" + selected.model : "";
    return (
      <aside
        className="ld-spirit-panel"
        aria-label={t("spirit")}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="ld-spirit-header">
          <div className="ld-spirit-heading">
            <SpiritIcon size={36} reducedMotion={reducedMotion} />
            <strong>{t("spirit")}</strong>
            <span
              className={"ld-spirit-dot " + (view?.busy ? "working" : "")}
            />
          </div>
          <div className="ld-spirit-controls">
            <button
              type="button"
              title={t("spiritNew")}
              aria-label={t("spiritNew")}
              disabled={pending || view?.busy}
              onClick={async () => {
                if (window.confirm(t("spiritNewConfirm"))) {
                  if (await command({ action: "new" }))
                    setAttempt((x) => x + 1);
                }
              }}
            >
              ＋
            </button>
            <button
              type="button"
              aria-label={t("close")}
              title={t("close")}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        <div className="ld-spirit-model">
          <select
            aria-label={t("spiritModel")}
            value={value}
            disabled={!catalog || pending || view?.busy}
            onChange={async (e) => {
              if (
                await command({
                  action: "selectModel",
                  selection:
                    e.target.value === "follow"
                      ? null
                      : JSON.parse(e.target.value),
                })
              )
                setAttempt((x) => x + 1);
            }}
          >
            <option value="follow">{t("spiritFollow")}</option>
            {catalog?.groups?.map((g: any) => (
              <optgroup key={g.id} label={g.name}>
                {g.models.map((m: any) => (
                  <option
                    key={m.id}
                    value={JSON.stringify({ provider: g.id, model: m.id })}
                  >
                    {m.name || m.id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            title={t("spiritModelsRefresh")}
            aria-label={t("spiritModelsRefresh")}
            onClick={async () => {
              try {
                setCatalog(await request({ action: "models" }));
                setError("");
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            ↻
          </button>
        </div>
        <div className="ld-spirit-model-caption" title={modelLabel}>
          {modelLabel || t("loading")}
        </div>
        <div
          className="ld-spirit-messages"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {!view?.messages?.length && !view?.busy && (
            <div className="ld-spirit-welcome">
              <SpiritIcon size={80} reducedMotion={reducedMotion} />
              <h2>{t("spiritWelcome")}</h2>
              <p>{t("spiritIntro")}</p>
              <div className="ld-spirit-examples">
                {["spiritExample1", "spiritExample2", "spiritExample3"].map(
                  (key) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => {
                        setDraft(t(key));
                        requestId.current = crypto.randomUUID();
                        input.current?.focus();
                      }}
                    >
                      {t(key)}
                      <span>↗</span>
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
          {view?.messages?.map((r: any) => (
            <div key={r.id} className={"ld-spirit-message ld-spirit-" + r.role}>
              {r.role === "operation" ? (
                <>
                  <span className={"ld-operation-state " + r.state}>
                    {r.state === "done" ? "✓" : r.state === "error" ? "!" : "·"}
                  </span>
                  <span>
                    {t("spiritOp" + (r.action || "read"))}
                    {" · "}
                    {t(
                      r.state === "done"
                        ? "spiritApplied"
                        : r.state === "error"
                          ? "error"
                          : "spiritWorking",
                    )}
                  </span>
                  {r.text && <p>{r.text}</p>}
                </>
              ) : (
                <>
                  {r.role === "assistant" && <small>{t("spirit")}</small>}
                  <div>{r.text}</div>
                </>
              )}
            </div>
          ))}
          {view?.liveText && (
            <div className="ld-spirit-message ld-spirit-assistant">
              <small>{t("spirit")}</small>
              <div>{view.liveText}</div>
            </div>
          )}
          {view?.busy && !view?.liveText && (
            <div className="ld-spirit-thinking">
              {t("spiritWorking")}
              <span>…</span>
            </div>
          )}
          <div ref={end} />
        </div>
        {error && (
          <div className="ld-spirit-error" role="alert">
            {error}
            <button type="button" onClick={() => setAttempt((x) => x + 1)}>
              {t("retry")}
            </button>
          </div>
        )}
        {catalog?.failures?.length > 0 && (
          <details className="ld-spirit-provider-errors">
            <summary>
              {t("spiritProviderErrors")} · {catalog.failures.length}
            </summary>
            {catalog.failures.map((f: any) => (
              <p key={f.id}>
                {f.name}: {f.message}
              </p>
            ))}
          </details>
        )}
        <form className="ld-spirit-compose" onSubmit={submit}>
          <textarea
            ref={input}
            value={draft}
            maxLength={16000}
            placeholder={t("spiritPlaceholder")}
            aria-label={t("spiritPlaceholder")}
            rows={3}
            onChange={(e) => {
              setDraft(e.target.value);
              requestId.current = crypto.randomUUID();
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <div className="ld-spirit-compose-foot">
            <span>{t("spiritEnterHint")}</span>
            {view?.busy ? (
              <button
                type="button"
                className="ld-btn"
                disabled={pending}
                onClick={() => void command({ action: "cancel" })}
              >
                {t("spiritStop")}
              </button>
            ) : (
              <button
                type="submit"
                className="ld-btn ld-primary"
                disabled={!draft.trim() || pending || !view}
              >
                {t("spiritSend")} ↑
              </button>
            )}
          </div>
        </form>
      </aside>
    );
  };
}
