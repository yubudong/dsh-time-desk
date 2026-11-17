import { z } from "zod";
import { createService } from "./model.js";
import { createSpirit } from "./spirit.js";
import {
  createUpdateService,
  detectInstallKind,
  detectDshVersion,
} from "./update.js";
import { createUpgradeService } from "./upgrade.js";
import { ProjectInput, TaskInput, HabitInput, Settings } from "./schema.js";
export const inject = [
  "storage",
  "storage.backend.json",
  "connection",
  "tools",
];
const guide = {
  save: "先 read 获取 revision；collection=projects/tasks/habits，item 遵循 schemas，修改带 id，未提供的字段保留。tasks.pomodoros 为预计番茄数量，0 表示不估算；完整专注轮数独立记录且不自动完成任务。删除用 trash，恢复用 restore。",
  occurrence:
    "重复事项的单次状态/改期：id=taskId、originalDate=原始发生日、date=改后日期、time=时刻、status=todo/doing/done/skipped/cancelled。无日期任务先 save 设置 date。",
  splitSeries:
    "修改这次及以后：id、originalDate、item 为新任务字段，必须先展示范围并得到用户同意。",
  habitLog:
    "id=habitId、date、value=本次增加数量，duration 习惯则为本次分钟（1–1440 整数）、note 可选、skipped 可选。status=missed 标记未达成；status=planned/unplanned 安排或取消该日的每周次数习惯，不产生打卡。撤销打卡用 removeId=habitLogId。周次数按不同天计算。",
  review:
    "date、kind=day/week、text（必须有回答内容，空白或只有模板问题不算完成），建议带复盘记录 version（新建为0）防止覆盖。复盘按归属日期记录，首次完成时间保留，编辑不重置；关联习惯只接受保存日复盘完成，不允许只打卡。HabitRule.allowNextDay 可选，默认false，开启后到次日全天结束仍按时；过窗未记录不自动判未达成。该规则按 effective 生效不追溯改过去。settings.reviewTemplate 一份个人默认日复盘问题，每行一个、最多8行2000字，不能从当日回答自动提取。",
  timer:
    "command=start/pause/resume/await/finish/discard；start 支持 phase=focus/short/long、taskId、originalDate，可通过 item.minutes 设置仅本轮专注时长（1–180 整数，不改变默认）。修改默认用 settings item.focusMinutes，不影响运行中计时；settings.timerFace 可为 digital/ring/flip/hourglass。其余计时操作需要 timerId。提前 finish 可传修正 seconds。",
  backup:
    "返回备份；restoreBackup 需要 backup、confirm=true 和最新 revision，先得到用户明确同意。restorePrevious 恢复导入前的持久备份。",
  rules:
    "公历 weekly.days:0=周日至6=周六。lunar.month/day 是农历，date 仍为首次生效公历日。leap=regular/only/both，missing=last/skip。preview 可检查未来三次日期。日期使用 settings.timeZone。普通未完成任务从安排日开始在后续日期持续待办，截止日是最晚期限；无需为今日显示而改期。range 是日历发生日查询，不等于包含延续任务的今日执行清单。",
  authority:
    "明确新增/打卡可直接执行；批量改期、删除项目、整组重复调整和备份覆盖前先展示影响范围并征得用户同意。勿推测金额、账期、习惯频率；仅使用用户提供的信息。请求重试复用 requestId。",
  plan: "action=plan，date=目标日；command=read 返回完整的当日重点、安排、计划待办、延续待选、负荷和未估时数，优先用它查看今日而非 range。command=capacity，item.availableMinutes=0–1440 或 null 清除；pick/unpick 用 id 与 originalDate 选择/取消延续待办，不改变原日期。写入须最新 revision。批量安排先展示方案获确认，不猜可用时间。minutes 优先于 pomodoros×默认 focusMinutes，不重复计时；无估时不算零时长。收件箱整理是 save 到项目/领域或日期，勿凭空移动截止日；取消重点只清 priorityDate。",
  ai: "时间精灵通过独立 DSH Agent 会话使用同一个 life_desk 工具；所有写入返回真实结果后再宣称完成。",
  assistant:
    "command=read/models 查看时间精灵状态或 DSH 模型目录；command=selectModel、item={provider,model} 设置精灵模型，省略 item 跟随 DSH 默认。此工具不能发送或伪造用户消息。",
  update:
    "command=status/check 查看或检查新版本；只检查自己的 GitHub 稳定发布，不下载、不安装、不修改插件文件。安装升级仍需用户在 DSH 插件管理器确认。",
};
export async function apply(ctx) {
  const unit = await ctx.storage.backend.get("json").kv.open({
    name: "life_desk_v1",
    version: 1,
    tables: ["backups"],
    hasGlobal: true,
    layout: "single",
  });
  let service;
  try {
    service = await createService(unit);
  } catch (error) {
    await unit.close();
    throw error;
  }
  ctx.effect(() => () => service.close());
  ctx.provide("lifeDesk", { operate: (a) => service.operate(a) });
  let updateService = null;
  try {
    const updateUnit = await ctx.storage.backend.get("json").kv.open({
      name: "life_desk_update",
      version: 1,
      tables: [],
      hasGlobal: true,
      layout: "single",
    });
    const currentVersion =
      typeof __LIFE_DESK_VERSION__ !== "undefined"
        ? __LIFE_DESK_VERSION__
        : "0.0.0";
    updateService = createUpdateService({
      unit: updateUnit,
      currentVersion,
      installKind: detectInstallKind(),
      dshVersion: detectDshVersion(),
    });
    await updateService.init();
    ctx.effect(() => () => updateService.close());
  } catch (error) {
    console.warn("time desk update checks unavailable:", error.message);
    updateService = null;
  }
  let upgradeService = null;
  try {
    const upgradeUnit = await ctx.storage.backend.get("json").kv.open({
      name: "life_desk_upgrade",
      version: 1,
      tables: [],
      hasGlobal: true,
      layout: "single",
    });
    upgradeService = createUpgradeService({
      unit: upgradeUnit,
      currentVersion:
        typeof __LIFE_DESK_VERSION__ !== "undefined"
          ? __LIFE_DESK_VERSION__
          : null,
      isBusy: async () =>
        !!(
          (spiritService &&
            (await spiritService.operate({ action: "read" })).busy) ||
          (reviewSpiritService &&
            (await reviewSpiritService.operate({ action: "read" })).busy)
        ),
      readState: () => service.operate({ action: "read" }),
      restoreState: (a) =>
        service.operate({
          action: "restoreBackup",
          backup: a.backup,
          revision: a.revision,
          confirm: true,
        }),
    });
    await upgradeService.init();
    ctx.effect(() => () => upgradeService.close());
  } catch (error) {
    console.warn("time desk upgrade snapshots unavailable:", error.message);
    upgradeService = null;
  }
  let spiritService = null;
  let reviewSpiritService = null;
  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: "/api/life-desk",
      methods: ["GET", "POST"],
      requestBody: "buffered",
      async fetch(req) {
        try {
          if (
            req.headers.get("content-length") &&
            Number(req.headers.get("content-length")) > 12 * 1024 * 1024
          )
            throw new Error("请求最多 12 MB");
          const a =
            req.method === "GET" ? { action: "read" } : await req.json();
          if (a.action === "upgrade") {
            if (!upgradeService) throw new Error("升级快照暂不可用");
            if (
              ![
                "preflight",
                "prepare",
                "snapshots",
                "restoreSnapshot",
                "clearPending",
              ].includes(a.command)
            )
              throw new Error("不支持的升级操作");
            return Response.json(
              { ok: true, value: await upgradeService.operate(a) },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
          if (a.action === "update") {
            if (!updateService) throw new Error("更新检查暂不可用");
            if (!["status", "check", "settings", "ignore"].includes(a.command))
              throw new Error("不支持的更新操作");
            return Response.json(
              { ok: true, value: await updateService.operate(a) },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
          return Response.json(
            { ok: true, value: await service.operate(a) },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          return Response.json(
            { ok: false, error: e.message },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    }),
  );
  ctx.effect(() =>
    ctx.tools.register({
      name: "life_desk",
      description:
        "管理时间工作台：项目、生活待办、公历/农历重复、数量/周次数习惯、复盘和番茄钟。首次调用 help 获取字段规范；修改前 read 获取 revision 和记录 ID。",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "help",
              "assistant",
              "update",
              "plan",
              "read",
              "save",
              "trash",
              "restore",
              "occurrence",
              "splitSeries",
              "habitLog",
              "review",
              "settings",
              "timer",
              "preview",
              "range",
              "backup",
              "restoreBackup",
              "restorePrevious",
              "undo",
              "ack",
            ],
          },
          revision: { type: "integer" },
          requestId: {
            type: "string",
            description: "同一次写入的唯一标识，重试复用。",
          },
          collection: { type: "string" },
          id: { type: "string" },
          version: { type: "integer" },
          item: { type: "object", additionalProperties: true },
          date: { type: "string" },
          originalDate: { type: "string" },
          time: { type: "string" },
          status: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          value: { type: "number" },
          note: { type: "string" },
          skipped: { type: "boolean" },
          removeId: { type: "string" },
          kind: { type: "string" },
          text: { type: "string" },
          command: { type: "string" },
          phase: { type: "string" },
          taskId: { type: "string" },
          timerId: { type: "string" },
          seconds: { type: "integer" },
          round: { type: "integer" },
          backup: { type: "object", additionalProperties: true },
          confirm: { type: "boolean" },
          autoCheck: { type: "boolean" },
          keys: { type: "array", items: { type: "string" } },
          offset: { type: "integer" },
          limit: { type: "integer" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_a, value) => [{ type: "text", text: JSON.stringify(value) }],
      },
      async execute(a) {
        if (a.action === "read" && a.collection === "assistant") {
          if (!spiritService) throw new Error("时间精灵服务未就绪");
          return spiritService.operate({
            action: a.command === "models" ? "models" : "read",
          });
        }
        if (a.action === "assistant") {
          if (!spiritService)
            throw new Error("时间精灵服务未就绪，请检查 DSH 模型与 Agent 服务");
          if (!["read", "models", "open", "selectModel"].includes(a.command))
            throw new Error(
              "助手工具仅提供 read/models/open/selectModel；发送用户消息需要在侧栏操作",
            );
          return spiritService.operate({
            action: a.command,
            selection: a.item || null,
          });
        }
        if (a.action === "update") {
          if (!updateService) throw new Error("更新检查暂不可用");
          const command = a.command || "status";
          if (!["status", "check"].includes(command))
            throw new Error("AI 仅可查看版本或检查更新");
          return updateService.operate({
            command,
            force: command === "check" ? false : undefined,
          });
        }
        if (a.action === "help")
          return {
            guide,
            schemas: {
              projects: z.toJSONSchema(ProjectInput),
              tasks: z.toJSONSchema(TaskInput),
              habits: z.toJSONSchema(HabitInput),
              settings: z.toJSONSchema(Settings),
            },
          };
        const value = await service.operate(a);
        if (a.action === "read") {
          const names = [
            "projects",
            "tasks",
            "habits",
            "occurrences",
            "habitLogs",
            "reviews",
            "focusLogs",
          ];
          const offset = Math.max(0, a.offset || 0),
            limit = Math.min(100, Math.max(1, a.limit || 30));
          const result = {
            revision: value.revision,
            settings: value.settings,
            timer: value.timer,
          };
          for (const k of names.filter(
            (k) => !a.collection || a.collection === k,
          )) {
            const items = value[k].filter((x) => !x.deletedAt);
            result[k] = {
              total: items.length,
              offset,
              items: items.slice(offset, offset + limit),
              hasMore: offset + limit < items.length,
            };
          }
          return result;
        }
        if (value?.schemaVersion)
          return {
            ok: true,
            revision: value.revision,
            counts: Object.fromEntries(
              ["projects", "tasks", "habits", "habitLogs", "focusLogs"].map(
                (k) => [k, value[k].filter((x) => !x.deletedAt).length],
              ),
            ),
            lastRecord:
              a.action === "save"
                ? value[a.collection].find((x) => x.id === a.id) ||
                  value[a.collection].at(-1)
                : undefined,
          };
        return value;
      },
    }),
  );
  if (typeof ctx.inject === "function")
    ctx.inject(
      ["agents", "agentLoop", "llm", "sessionController", "systemPrompt"],
      async (assistantCtx) => {
        const assistantUnit = await assistantCtx.storage.backend
          .get("json")
          .kv.open({
            name: "life_desk_spirit",
            version: 1,
            tables: [],
            hasGlobal: true,
            layout: "single",
          });
        let spirit;
        try {
          spirit = await createSpirit(assistantCtx, assistantUnit);
        } catch (error) {
          await assistantUnit.close();
          throw error;
        }
        spiritService = spirit;
        assistantCtx.effect(() => async () => {
          spiritService = null;
          await spirit.close();
        });
        // A separate Agent session with a scoped draft-only tool. It cannot
        // execute general workbench actions or save a review without UI consent.
        const reviewUnit = await assistantCtx.storage.backend
          .get("json")
          .kv.open({
            name: "life_desk_review_spirit",
            version: 1,
            tables: [],
            hasGlobal: true,
            layout: "single",
          });
        const reviewAssistant = await createSpirit(assistantCtx, reviewUnit, {
          reviewOnly: true,
          readState: () => service.operate({ action: "read" }),
        });
        reviewSpiritService = reviewAssistant;
        assistantCtx.effect(() => async () => {
          reviewSpiritService = null;
          await reviewAssistant.close();
        });
        assistantCtx.effect(() =>
          assistantCtx.connection.fetch.register({
            path: "/api/life-desk-review-spirit",
            methods: ["POST"],
            requestBody: "buffered",
            async fetch(req) {
              try {
                if (Number(req.headers.get("content-length") || 0) > 128 * 1024)
                  throw Error("复盘请求过大");
                const body = await req.json();
                if (
                  !["startReview", "send", "watch", "read", "cancel"].includes(
                    body.action,
                  )
                )
                  throw Error("不支持的复盘助手操作");
                return Response.json(
                  {
                    ok: true,
                    value: await reviewAssistant.operate(body, req.signal),
                  },
                  { headers: { "Cache-Control": "no-store" } },
                );
              } catch (error) {
                return Response.json(
                  { ok: false, error: error.message },
                  { status: 400, headers: { "Cache-Control": "no-store" } },
                );
              }
            },
          }),
        );
        assistantCtx.provide("lifeSpirit", {
          operate: (a, signal) => spirit.operate(a, signal),
        });
        assistantCtx.effect(() =>
          assistantCtx.connection.fetch.register({
            path: "/api/life-desk-spirit",
            methods: ["POST"],
            requestBody: "buffered",
            async fetch(req) {
              try {
                const body = await req.json();
                return Response.json(
                  { ok: true, value: await spirit.operate(body, req.signal) },
                  { headers: { "Cache-Control": "no-store" } },
                );
              } catch (error) {
                return Response.json(
                  { ok: false, error: error.message },
                  { status: 400, headers: { "Cache-Control": "no-store" } },
                );
              }
            },
          }),
        );
      },
    );
}
