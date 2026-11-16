// Phase 2B: pre-upgrade snapshot and hand-off bookkeeping. This module never
// installs anything; DSH Plugin Manager owns installation after user consent.
import { compareVersions, parseVersion } from "./update-core.js";

export const MAX_SNAPSHOTS = 3;
export const MAX_STATE_CHARS = 2 * 1024 * 1024;
const DEFAULT = { pending: null, snapshots: [] };

function summary(snapshot) {
  return {
    id: snapshot.id,
    fromVersion: snapshot.fromVersion,
    targetVersion: snapshot.targetVersion,
    createdAt: snapshot.createdAt,
    bytes: snapshot.bytes,
    counts: snapshot.counts,
  };
}

export function createUpgradeService({
  unit,
  readState,
  restoreState,
  clock = () => Date.now(),
}) {
  let global = { ...DEFAULT };
  let queue = Promise.resolve();
  const snapshot = () => ({
    pending: global.pending,
    snapshots: global.snapshots.map(summary),
    currentVersion: global.currentVersion || null,
  });
  async function persist() {
    await unit.setGlobal(structuredClone(global));
  }
  function ensureRoom(state) {
    const encoded = JSON.stringify(state);
    if (encoded.length > MAX_STATE_CHARS)
      throw Error("工作台数据过大，无法创建升级前快照");
    return encoded.length;
  }
  return {
    async init() {
      const stored = (await unit.loadAll())?.global;
      if (stored && typeof stored === "object") {
        global = {
          pending:
            stored.pending && typeof stored.pending === "object"
              ? stored.pending
              : null,
          snapshots: Array.isArray(stored.snapshots)
            ? stored.snapshots
                .filter((x) => x && typeof x.id === "string" && x.state)
                .slice(-MAX_SNAPSHOTS)
            : [],
        };
      }
      return snapshot();
    },
    operate(a) {
      const run = queue.then(async () => {
        const command = a.command;
        if (command === "preflight") {
          const state = await readState();
          const timer = state.timer;
          const blockers = [];
          if (timer)
            blockers.push({
              code: "timer",
              phase: timer.phase,
              status: timer.status,
            });
          return {
            ok: blockers.length === 0,
            blockers,
            timer: timer ? { phase: timer.phase, status: timer.status } : null,
          };
        }
        if (command === "prepare") {
          const state = await readState();
          if (state.timer) throw Error("请先结束当前计时，再准备升级");
          const from = a.fromVersion || "unknown";
          const target = a.targetVersion;
          if (!parseVersion(target)) throw Error("目标版本号无效");
          if (parseVersion(from) && compareVersions(target, from) <= 0)
            throw Error("目标版本必须高于当前版本");
          for (const key of ["projects", "tasks", "habits", "focusLogs"])
            if (!Array.isArray(state[key]))
              throw Error(
                "快照数据缺少 " +
                  key +
                  "：keys=" +
                  Object.keys(state || {}).join(",") +
                  " type=" +
                  Object.prototype.toString.call(state),
              );
          const bytes = ensureRoom(state);
          const record = {
            id: "snapshot-" + clock() + "-" + global.snapshots.length,
            fromVersion: from,
            targetVersion: target,
            createdAt: clock(),
            bytes,
            counts: {
              projects: state.projects.length,
              tasks: state.tasks.length,
              habits: state.habits.length,
              focusLogs: state.focusLogs.length,
            },
            state,
          };
          global.snapshots = [...global.snapshots, record].slice(
            -MAX_SNAPSHOTS,
          );
          global.pending = {
            targetVersion: target,
            fromVersion: from,
            preparedAt: record.createdAt,
            snapshotId: record.id,
          };
          global.currentVersion = from;
          await persist();
          return { ok: true, prepared: summary(record), ...snapshot() };
        }
        if (command === "snapshots") return snapshot();
        if (command === "clearPending") {
          global.pending = null;
          await persist();
          return snapshot();
        }
        if (command === "restoreSnapshot") {
          if (a.confirm !== true) throw Error("恢复需要确认");
          const record = global.snapshots.find((x) => x.id === a.id);
          if (!record) throw Error("快照不存在");
          await restoreState({
            backup: {
              format: "dsh-time-desk",
              exportedAt: new Date(record.createdAt).toISOString(),
              state: record.state,
            },
            revision: a.revision,
            confirm: true,
          });
          global.pending = null;
          await persist();
          return { ok: true, restored: summary(record), ...snapshot() };
        }
        return snapshot();
      });
      queue = run.catch(() => {});
      return run;
    },
    async close() {
      await unit.close();
    },
  };
}
