import { randomUUID } from "node:crypto";

export const SPIRIT_PROMPT = `你是“时间精灵”，是用户时间工作台内的个人助手。用户就在旁边看着项目、习惯、日历和生活事项，正在与你对话。
你的职责是理解大白话，通过 life_desk 工具查询和修改工作台，协助安排工作与生活。
首次使用先 life_desk help/read；修改前获取最新 revision。只根据工具返回结果声称完成，不得假装修改。支持多轮补充与改口，先读取现有记录避免重复创建。规则不清楚时只问关键问题。
只处理时间工作台，不使用文件、终端、网络或其他会话工具。life_desk 是唯一业务工具。
名称简洁，回应自然具体，不讲接口和 JSON。明确的新增/打卡/单项改动直接执行；批量改期、删除项目、整组重复规则调整和备份覆盖先展示影响范围并等用户明确同意，不能自行代替用户确认。
金额、账期、习惯频率和提醒时刻不要猜。用户说“一周三次”是 weekly 目标 3；“跳绳1000个”是 quantity target1000 unit个，不要把数量混进标题。只有复盘类打卡才设 reviewLinked=true，运动阅读等保持 false。
公历/农历规则使用程序 preview 核对；时区以 life_desk read 的 settings.timeZone 为准，日期含义不确定时询问。
本轮取消不会回滚已经完成的修改；用户想恢复时先读当前状态，再使用撤销或相应反向操作。
先完成实际操作，再简明说清结果。除非用户要求方案，不要只给建议而不执行已明确授权的事项。`;

const textContent = (message) =>
  (message?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
export function transcriptRow(event) {
  const { type, data, seq, time } = event;
  if (type === "user/message")
    return {
      id: data.id || String(seq),
      role: "user",
      text: textContent(data),
      time,
    };
  if (type === "assistant/message") {
    const text = textContent(data.message);
    return text
      ? { id: data.message.id || String(seq), role: "assistant", text, time }
      : null;
  }
  if (type === "tool/call")
    return {
      id: "call:" + data.callId,
      role: "operation",
      action: (() => {
        try {
          return JSON.parse(data.arguments).action || "";
        } catch {
          return "";
        }
      })(),
      state: "running",
      text: "",
      time,
    };
  if (type === "turn/end" && data.reason?.kind === "error")
    return {
      id: "error:" + seq,
      role: "error",
      text: data.reason.error?.message || "模型请求失败",
      time,
    };
  return null;
}

export async function createSpirit(ctx, unit) {
  const saved = (await unit.loadAll()).global;
  let meta =
    saved && typeof saved.sessionId === "string"
      ? saved
      : { sessionId: "", selection: null };
  let handle = null,
    opening = null,
    closed = false,
    serial = Promise.resolve();
  let version = 0,
    busy = false,
    liveText = "",
    rows = [],
    removers = [],
    receipts = new Set();
  const waiters = new Set();
  const notify = () => {
    version++;
    for (const f of [...waiters]) f();
    waiters.clear();
  };
  const saveMeta = async () => unit.setGlobal(meta);
  const view = () => ({
    sessionId: meta.sessionId,
    selection: meta.selection,
    version,
    busy,
    liveText,
    messages: rows.slice(-160),
  });
  const op = (fn) => {
    const run = serial.then(fn);
    serial = run.catch(() => {});
    return run;
  };
  async function catalog() {
    const value = await ctx.sessionController.modelCatalog();
    return {
      default: value.default,
      groups: value.groups,
      failures: value.failures,
    };
  }
  async function choose(selection) {
    const c = await catalog();
    const next = selection || c.default;
    if (!next?.provider || !next?.model)
      throw new Error("请先在 DSH 中配置可用模型");
    if (
      !c.groups.some(
        (g) =>
          g.id === next.provider && g.models.some((m) => m.id === next.model),
      )
    )
      throw new Error("该模型当前不在 DSH 可用模型列表中，请刷新模型目录");
    const config = await ctx.llm.resolveCallConfig({
      provider: next.provider,
      model: next.model,
      ...(next.reasoningEffort
        ? { reasoningEffort: next.reasoningEffort }
        : {}),
    });
    return {
      provider: config.provider,
      model: config.model,
      ...(config.reasoningEffort
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
    };
  }
  function setup(agentCtx, agent) {
    // Every contribution has both the Agent and this plugin as owners.
    const effects = agentCtx.effect(() => {
      const cleanups = [
        agentCtx.tools.restrict({ allow: ["life_desk"] }),
        agentCtx.systemPrompt.section({
          name: "life-desk-spirit",
          order: 0,
          complete: true,
          text: SPIRIT_PROMPT,
        }),
        agentCtx.on("agent/assistant-stream", ({ frame }) => {
          if (frame.type === "start") {
            liveText = "";
            notify();
          } else if (
            frame.type === "chunk" &&
            frame.chunk.type === "text-delta"
          ) {
            liveText += frame.chunk.text;
            notify();
          } else if (frame.type === "end") {
            liveText = "";
            notify();
          }
        }),
        agentCtx.on("session/event", (session, event) => {
          if (session.id !== agent.id) return;
          const row = transcriptRow(event);
          if (row && !rows.some((r) => r.id === row.id)) rows.push(row);
          if (event.type === "user/message") receipts.add(event.data.id);
          if (event.type === "turn/start") busy = true;
          if (event.type === "turn/end") {
            busy = false;
            liveText = "";
          }
          if (event.type === "tool/result") {
            const callId = event.data.callId || event.data.message?.toolCallId;
            const row = rows.find((r) => r.id === "call:" + callId);
            if (row) {
              row.state = event.data.message?.isError ? "error" : "done";
              row.text =
                row.state === "error"
                  ? textContent(event.data.message).slice(0, 500)
                  : "";
            }
          }
          rows = rows.slice(-240);
          notify();
        }),
      ];
      return () => {
        for (const dispose of cleanups.reverse()) dispose();
      };
    });
    removers.push(effects);
  }
  async function ensure() {
    if (closed) throw new Error("时间精灵正在更新，请重新打开工作台");
    if (handle) return handle.agent;
    if (opening) return opening;
    opening = (async () => {
      const config = await choose(meta.selection);
      if (meta.sessionId) {
        // Never silently replace a conversation if restore failed.
        handle = await ctx.agents.resume({
          resumeSessionId: meta.sessionId,
          agentOptions: config,
          setup,
        });
      } else {
        handle = await ctx.agents.create({
          sessionId: randomUUID(),
          agentOptions: config,
          setup,
        });
        const sessionId = handle.agent.id;
        await ctx.sessionController.rename({
          sessionId,
          title: "时间精灵",
        });
        await handle.agent.ctx.sessions.flush(handle.agent.session);
        meta.sessionId = sessionId;
        await saveMeta();
      }
      const agent = handle.agent;
      rows = [];
      for (const event of agent.session.snapshotEvents()) {
        const row = transcriptRow(event);
        if (row) rows.push(row);
        if (event.type === "tool/result") {
          const id = event.data.callId || event.data.message?.toolCallId;
          const row = rows.find((r) => r.id === "call:" + id);
          if (row) row.state = event.data.message?.isError ? "error" : "done";
        }
        if (event.type === "user/message") receipts.add(event.data.id);
      }
      for (const message of [...agent.inbox.nextTurn, ...agent.inbox.nextStep])
        receipts.add(message.id);
      rows = rows.slice(-240);
      busy = agent.status === "running";
      notify();
      return agent;
    })();
    try {
      return await opening;
    } finally {
      opening = null;
    }
  }
  return {
    async operate(a, signal) {
      if (a.action === "models") return catalog();
      if (a.action === "open") {
        await ensure();
        return view();
      }
      if (a.action === "watch") {
        if (a.after === version && !signal?.aborted)
          await new Promise((resolve) => {
            let timer;
            const done = () => {
              clearTimeout(timer);
              waiters.delete(done);
              signal?.removeEventListener("abort", done);
              resolve();
            };
            waiters.add(done);
            timer = setTimeout(done, 10000);
            signal?.addEventListener("abort", done, { once: true });
            if (signal?.aborted) done();
          });
        return view();
      }
      if (a.action === "read") return view();
      if (a.action === "cancel") {
        const agent = await ensure();
        agent.cancel({ kind: "user" });
        return view();
      }
      return op(async () => {
        if (a.action === "selectModel") {
          if (busy) throw new Error("请等待本轮结束或停止后再切换模型");
          const config = await choose(a.selection || null);
          if (handle) handle.agent.model.select(config);
          meta.selection = a.selection
            ? {
                provider: config.provider,
                model: config.model,
                ...(config.reasoningEffort
                  ? { reasoningEffort: config.reasoningEffort }
                  : {}),
              }
            : null;
          await saveMeta();
          notify();
          return view();
        }
        if (a.action === "send") {
          const text = typeof a.text === "string" ? a.text.trim() : "";
          if (!text || text.length > 16000)
            throw new Error("请输入 1–16000 字的安排");
          if (
            typeof a.requestId !== "string" ||
            a.requestId.length < 8 ||
            a.requestId.length > 200
          )
            throw new Error("请求标识无效");
          const agent = await ensure();
          if (receipts.has(a.requestId)) return view();
          if (busy)
            throw new Error("时间精灵正在处理上一条消息，可以先停止或等待完成");
          agent.model.select(await choose(meta.selection));
          busy = true;
          notify();
          try {
            agent.followup({
              id: a.requestId,
              role: "user",
              source: { kind: "user" },
              content: [{ type: "text", text }],
            });
            receipts.add(a.requestId);
          } catch (error) {
            busy = false;
            notify();
            throw error;
          }
          return view();
        }
        if (a.action === "new") {
          if (busy) throw new Error("请先停止本轮对话");
          if (handle) await handle.dispose();
          handle = null;
          for (const remove of removers.splice(0)) await remove();
          meta.sessionId = "";
          rows = [];
          receipts = new Set();
          liveText = "";
          await saveMeta();
          notify();
          return view();
        }
        throw new Error("未知的时间精灵操作");
      });
    },
    async close() {
      closed = true;
      for (const done of [...waiters]) done();
      if (handle)
        handle.agent.cancel({ kind: "disposed" }, { keepInbox: true });
      await serial;
      if (opening) await opening.catch(() => {});
      if (handle) await handle.dispose();
      for (const remove of removers.splice(0)) await remove();
      await unit.close();
    },
  };
}
