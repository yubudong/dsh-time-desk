import { blankState } from "../src/schema.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createSpirit, transcriptRow, SPIRIT_PROMPT } from "../src/spirit.js";

function fixture({ reviewOnly = false } = {}) {
  let scopedTool;
  let global = null,
    currentDefault = { provider: "mock", model: "one" },
    configCalls = [],
    created = 0,
    resumed = 0,
    disposed = 0,
    promptCount = 0;
  const sessions = new Map();
  let active;
  const unit = {
    async loadAll() {
      return structuredClone({ global });
    },
    async setGlobal(value) {
      global = structuredClone(value);
    },
    async close() {},
  };
  const attach = async (options, resume = false) => {
    const id = options.sessionId || options.resumeSessionId;
    const events = resume ? sessions.get(id) || [] : [];
    sessions.set(id, events);
    const listeners = new Map(),
      cleanups = [];
    const agent = {
      id,
      status: "idle",
      inbox: { nextTurn: [], nextStep: [] },
      session: {
        snapshotEvents() {
          return [...events];
        },
      },
      model: {
        select(v) {
          agent.selected = v;
        },
      },
      followup(message) {
        promptCount++;
        agent.status = "running";
        emit("turn/start", { turn: 1 });
        emit("user/message", message);
      },
      cancel() {
        agent.status = "idle";
        emit("turn/end", { reason: { kind: "aborted" } });
      },
    };
    function emit(type, data) {
      const event = { type, data, seq: events.length, time: Date.now() };
      events.push(event);
      listeners.get("session/event")?.(agent.session, event);
    }
    agent.session.id = id;
    const agentCtx = {
      sessions: { async flush() {} },
      effect(fn) {
        const dispose = fn();
        cleanups.push(dispose);
        return () => {
          const i = cleanups.indexOf(dispose);
          if (i >= 0) {
            cleanups.splice(i, 1);
            dispose?.();
          }
        };
      },
      tools: {
        register(definition) {
          scopedTool = definition;
          return () => {};
        },
        restrict(value) {
          assert.deepEqual(value, { allow: ["life_desk"] });
          return () => {};
        },
      },
      systemPrompt: {
        section(value) {
          assert.equal(value.complete, true);
          assert.match(value.text, /时间精灵/);
          return () => {};
        },
      },
      on(event, fn) {
        listeners.set(event, fn);
        return () => listeners.delete(event);
      },
    };
    agent.ctx = agentCtx;
    await options.setup(agentCtx, agent);
    active = {
      agent,
      emit,
      stream(frame) {
        listeners.get("agent/assistant-stream")?.({ agent, frame });
      },
      finish(text = "已完成") {
        emit("assistant/message", {
          message: {
            id: "reply" + events.length,
            role: "assistant",
            content: [{ type: "text", text }],
          },
        });
        agent.status = "idle";
        emit("turn/end", { reason: { kind: "completed" } });
      },
    };
    return {
      agent,
      async dispose() {
        disposed++;
        for (const fn of cleanups.splice(0)) fn?.();
      },
    };
  };
  const ctx = {
    agents: {
      async create(options) {
        created++;
        return attach(options);
      },
      async resume(options) {
        resumed++;
        return attach(options, true);
      },
    },
    sessionController: {
      async modelCatalog() {
        return {
          default: currentDefault,
          groups: [
            {
              id: "mock",
              name: "Mock",
              models: [
                { id: "one", name: "One" },
                { id: "two", name: "Two" },
              ],
            },
          ],
          failures: [],
        };
      },
      async rename(req) {
        if (reviewOnly) assert.match(req.title, /^复盘精灵/);
        else assert.equal(req.title, "时间精灵");
      },
    },
    llm: {
      async resolveCallConfig(value) {
        configCalls.push(value);
        return value;
      },
    },
  };
  return {
    ctx,
    unit,
    get scopedTool() {
      return scopedTool;
    },
    get active() {
      return active;
    },
    get created() {
      return created;
    },
    get resumed() {
      return resumed;
    },
    get prompts() {
      return promptCount;
    },
    get disposed() {
      return disposed;
    },
    setDefault(v) {
      currentDefault = v;
    },
    configCalls,
  };
}

test("opening creates one scoped DSH conversation without a model prompt", async () => {
  const f = fixture(),
    s = await createSpirit(f.ctx, f.unit);
  const a = await s.operate({ action: "open" });
  await s.operate({ action: "open" });
  assert.ok(a.sessionId);
  assert.equal(f.created, 1);
  assert.equal(f.prompts, 0);
  assert.equal(a.busy, false);
  await s.close();
  assert.equal(f.disposed, 1);
});
test("send retries do not duplicate user input and preserve actual transcript", async () => {
  const f = fixture(),
    s = await createSpirit(f.ctx, f.unit);
  const request = {
    action: "send",
    requestId: "request-123",
    text: "创建一个习惯",
  };
  await s.operate(request);
  await s.operate(request);
  assert.equal(f.prompts, 1);
  assert.equal(
    (await s.operate({ action: "read" })).messages[0].text,
    request.text,
  );
  f.active.finish("已创建");
  const view = await s.operate({ action: "read" });
  assert.equal(view.messages.at(-1).text, "已创建");
  assert.equal(view.busy, false);
  await s.close();
});
test("transient text and tool receipts are driven by Agent events", async () => {
  const f = fixture(),
    s = await createSpirit(f.ctx, f.unit);
  await s.operate({ action: "send", requestId: "request-123", text: "记录" });
  f.active.stream({ type: "start" });
  f.active.stream({
    type: "chunk",
    chunk: { type: "text-delta", text: "正在" },
  });
  assert.equal((await s.operate({ action: "read" })).liveText, "正在");
  f.active.emit("tool/call", {
    callId: "c1",
    arguments: JSON.stringify({ action: "save" }),
  });
  f.active.emit("tool/result", {
    message: { toolCallId: "c1", isError: false },
  });
  const view = await s.operate({ action: "read" });
  assert.equal(view.messages.find((x) => x.id === "call:c1").state, "done");
  f.active.finish();
  await s.close();
});
test("follow default reads DSH's latest selection for each turn", async () => {
  const f = fixture(),
    s = await createSpirit(f.ctx, f.unit);
  await s.operate({ action: "send", requestId: "request-111", text: "查看" });
  f.active.finish();
  f.setDefault({ provider: "mock", model: "two" });
  await s.operate({ action: "send", requestId: "request-222", text: "再查看" });
  assert.equal(f.active.agent.selected.model, "two");
  await s.close();
});
test("explicit model is local to the helper and switching while busy rejects", async () => {
  const f = fixture(),
    s = await createSpirit(f.ctx, f.unit);
  await s.operate({
    action: "selectModel",
    selection: { provider: "mock", model: "two" },
  });
  await s.operate({ action: "send", requestId: "request-111", text: "查看" });
  assert.equal(f.active.agent.selected.model, "two");
  await assert.rejects(
    s.operate({ action: "selectModel", selection: null }),
    /等待/,
  );
  await s.operate({ action: "cancel" });
  await s.operate({ action: "selectModel", selection: null });
  assert.equal((await s.operate({ action: "models" })).default.model, "one");
  await s.close();
});
test("invalid and unavailable models fail before starting a conversation", async () => {
  const f = fixture(),
    s = await createSpirit(f.ctx, f.unit);
  await assert.rejects(
    s.operate({
      action: "selectModel",
      selection: { provider: "missing", model: "x" },
    }),
    /可用模型/,
  );
  assert.equal(f.created, 0);
  await s.close();
});
test("history is restored from the DSH session log on remount", async () => {
  const f = fixture();
  let s = await createSpirit(f.ctx, f.unit);
  await s.operate({
    action: "send",
    requestId: "request-111",
    text: "保留这段对话",
  });
  f.active.finish("收到");
  const id = (await s.operate({ action: "read" })).sessionId;
  await s.close();
  s = await createSpirit(f.ctx, f.unit);
  const view = await s.operate({ action: "open" });
  assert.equal(view.sessionId, id);
  assert.equal(f.resumed, 1);
  assert.ok(view.messages.some((x) => x.text === "保留这段对话"));
  await s.close();
});
test("new conversation releases old lifecycle without deleting old history", async () => {
  const f = fixture(),
    s = await createSpirit(f.ctx, f.unit);
  const initial = await s.operate({ action: "open" });
  await s.operate({ action: "new" });
  const next = await s.operate({ action: "open" });
  assert.notEqual(initial.sessionId, next.sessionId);
  assert.equal(f.created, 2);
  assert.equal(f.disposed, 1);
  await s.close();
});
test("watch wakes from committed events and aborting a watch is harmless", async () => {
  const f = fixture(),
    s = await createSpirit(f.ctx, f.unit);
  const initial = await s.operate({ action: "open" });
  const waiting = s.operate({ action: "watch", after: initial.version });
  await s.operate({ action: "send", requestId: "request-111", text: "查看" });
  assert.ok((await waiting).version > initial.version);
  const current = await s.operate({ action: "read" });
  const controller = new AbortController();
  const second = s.operate(
    { action: "watch", after: current.version },
    controller.signal,
  );
  controller.abort();
  assert.equal((await second).sessionId, current.sessionId);
  await s.close();
});
test("prompt scope is restricted and error transcript stays explicit", () => {
  assert.match(SPIRIT_PROMPT, /唯一业务工具/);
  assert.match(SPIRIT_PROMPT, /先展示影响范围/);
  assert.equal(
    transcriptRow({
      type: "turn/end",
      seq: 5,
      time: 1,
      data: {
        reason: { kind: "error", error: { message: "Model unavailable" } },
      },
    }).text,
    "Model unavailable",
  );
});

test("guided review uses a scoped draft-only tool and cannot write workspace records", async () => {
  const f = fixture({ reviewOnly: true }),
    state = blankState("synthetic");
  state.settings.reviewTemplate = "我的收获？\n下一步？";
  const service = await createSpirit(f.ctx, f.unit, {
    reviewOnly: true,
    readState: async () => state,
  });
  const started = await service.operate({
    action: "startReview",
    date: "2026-11-16",
    text: "已有想法",
    version: 0,
    requestId: "guided-review-one",
  });
  assert.equal(started.review.date, "2026-11-16");
  assert.equal(f.prompts, 1);
  assert.equal(f.scopedTool.name, "life_desk");
  assert.deepEqual(f.scopedTool.parameters.properties.action.enum, ["draft"]);
  await assert.rejects(
    f.scopedTool.execute({ action: "save", text: "invalid" }),
    /会话/,
  );
  await f.scopedTool.execute({
    action: "draft",
    text: "我今天学到一件事。明天继续练习。",
  });
  const view = await service.operate({ action: "read" });
  assert.match(view.review.draft, /学到/);
  assert.equal(state.reviews.length, 0);
  assert.equal(state.habitLogs.length, 0);
  assert.equal(
    (
      await service.operate({
        action: "startReview",
        date: "2026-11-16",
        requestId: "guided-review-one",
      })
    ).sessionId,
    started.sessionId,
  );
  assert.equal(f.prompts, 1);
  await service.close();
});
test("review assistant rejects stale source and unfinished template prompts", async () => {
  const f = fixture({ reviewOnly: true }),
    state = blankState("synthetic");
  const service = await createSpirit(f.ctx, f.unit, {
    reviewOnly: true,
    readState: async () => state,
  });
  await assert.rejects(
    service.operate({
      action: "startReview",
      date: "2026-11-16",
      version: 1,
      requestId: "guided-review-stale",
    }),
    /变化/,
  );
  await service.operate({
    action: "startReview",
    date: "2026-11-16",
    version: 0,
    requestId: "guided-review-valid",
  });
  await assert.rejects(
    f.scopedTool.execute({ action: "draft", text: "今天值得记下的事：" }),
    /内容/,
  );
  await service.close();
});
