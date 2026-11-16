import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UPDATE_API,
  UPDATE_PAGE,
  UPDATE_FEED,
  UPDATE_REPOSITORY,
  AUTO_CHECK_INTERVAL,
  MANUAL_CHECK_COOLDOWN,
  normalizeRelease,
  parseReleaseFeed,
  updateState,
  parseVersion,
} from "./update-core.js";

const MAX_BODY = 512 * 1024;
const TIMEOUT = 10_000;
const DEFAULT = {
  autoCheck: false,
  ignoredVersion: "",
  lastCheck: 0,
  cache: null,
};

function fileExists(path) {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}
/** Best-effort only: unknown is reported honestly, never guessed as compatible. */
export function detectInstallKind(moduleUrl = import.meta.url) {
  try {
    let dir = dirname(fileURLToPath(moduleUrl));
    for (let i = 0; i < 4; i++) {
      const manifest = join(dir, "package.json");
      if (fileExists(manifest)) {
        const data = JSON.parse(readFileSync(manifest, "utf8"));
        if (data?.name === "dsh-time-desk") {
          if (dir.includes(`${join("node_modules")}`)) return "managed";
          return fileExists(join(dir, ".git")) ? "development" : "managed";
        }
      }
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}
  return "unknown";
}
export function detectDshVersion() {
  for (const key of ["DSH_VERSION", "DSH_APP_VERSION", "DSH_RUNTIME_VERSION"]) {
    const value = process.env?.[key];
    if (value && parseVersion(value)) return value;
  }
  const resources = process.resourcesPath;
  if (!resources) return null;
  for (const rel of ["app.asar/dsh/package.json", "app/dsh/package.json"]) {
    try {
      const data = JSON.parse(readFileSync(join(resources, rel), "utf8"));
      if (data?.version && parseVersion(data.version)) return data.version;
    } catch {}
  }
  return null;
}

async function boundedText(fetchImpl, url, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: accept,
        "User-Agent": "dsh-time-desk-update-check",
      },
      redirect: "follow",
    });
    if (res.status === 404)
      throw Object.assign(Error("未找到正式发布版本"), { code: "missing" });
    if (res.status === 403 || res.status === 429)
      throw Object.assign(Error("检查请求过于频繁，请稍后再试"), {
        code: "rate",
      });
    if (!res.ok) throw Error(`检查失败（HTTP ${res.status}）`);
    const length = Number(res.headers.get("content-length") || 0);
    if (length > MAX_BODY) throw Error("发布信息过大，已停止读取");
    const text = await res.text();
    if (text.length > MAX_BODY) throw Error("发布信息过大，已停止读取");
    return text;
  } catch (error) {
    if (error.name === "AbortError") throw Error("检查更新超时，请稍后再试");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function boundedJson(fetchImpl, url) {
  return JSON.parse(
    await boundedText(fetchImpl, url, "application/vnd.github+json"),
  );
}

async function dshRangeOf(fetchImpl, version) {
  try {
    const manifest = JSON.parse(
      await boundedText(
        fetchImpl,
        `https://raw.githubusercontent.com/${UPDATE_REPOSITORY}/v${version}/package.json`,
        "application/json",
      ),
    );
    if (manifest?.name === "dsh-time-desk" && manifest.version === version)
      return typeof manifest.engines?.dsh === "string"
        ? manifest.engines.dsh
        : null;
  } catch {}
  return null;
}

export async function fetchLatest({
  fetchImpl = globalThis.fetch,
  currentVersion,
} = {}) {
  if (typeof fetchImpl !== "function") throw Error("当前环境不支持网络检查");
  let release;
  let degraded = null;
  try {
    release = normalizeRelease(await boundedJson(fetchImpl, UPDATE_API), {
      currentVersion,
    });
  } catch (error) {
    // The anonymous API allows 60 requests/hour per IP. The repository's public
    // Atom feed has no such limit; use it only as an explicit fallback.
    if (error.code !== "rate") throw error;
    release = parseReleaseFeed(
      await boundedText(fetchImpl, UPDATE_FEED, "application/atom+xml"),
      { currentVersion },
    );
    degraded = "feed";
  }
  return {
    release,
    dshRange: await dshRangeOf(fetchImpl, release.version),
    degraded,
    fetchedAt: Date.now(),
  };
}

export function createUpdateService({
  unit,
  currentVersion,
  installKind = "unknown",
  dshVersion = null,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
}) {
  let prefs = { ...DEFAULT };
  let queue = Promise.resolve();
  const snapshot = (extra = {}) => ({
    currentVersion,
    installKind,
    dshVersion: dshVersion || null,
    repository: UPDATE_REPOSITORY,
    autoInterval: AUTO_CHECK_INTERVAL,
    releasePage: UPDATE_PAGE,
    prefs: {
      autoCheck: !!prefs.autoCheck,
      ignoredVersion: prefs.ignoredVersion || "",
    },
    lastCheck: prefs.lastCheck || 0,
    cache: prefs.cache || null,
    degraded: (prefs.cache && prefs.cache.degraded) || null,
    ...extra,
  });
  function state() {
    if (!prefs.cache) return { kind: "none" };
    return updateState({
      release: prefs.cache.release,
      currentVersion,
      dshVersion,
      dshRange: prefs.cache.dshRange,
      ignoredVersion: prefs.ignoredVersion,
    });
  }
  async function persist() {
    await unit.setGlobal({ ...prefs });
  }
  return {
    async init() {
      const all = await unit.loadAll();
      const stored = all?.global;
      if (stored && typeof stored === "object")
        prefs = {
          autoCheck: !!stored.autoCheck,
          ignoredVersion:
            typeof stored.ignoredVersion === "string"
              ? stored.ignoredVersion
              : "",
          lastCheck: Number.isFinite(stored.lastCheck) ? stored.lastCheck : 0,
          cache:
            stored.cache && typeof stored.cache === "object"
              ? stored.cache
              : null,
        };
      return snapshot({ state: state() });
    },
    operate(a) {
      const run = queue.then(async () => {
        const command = a.command;
        if (command === "settings") {
          if (typeof a.autoCheck === "boolean") prefs.autoCheck = a.autoCheck;
          await persist();
          return snapshot({ state: state() });
        }
        if (command === "ignore") {
          const v =
            typeof a.version === "string" ? a.version.replace(/^v/, "") : "";
          if (v && !parseVersion(v)) throw Error("版本号无效");
          prefs.ignoredVersion = v;
          await persist();
          return snapshot({ state: state() });
        }
        if (command === "check") {
          const now = clock();
          if (
            !a.force &&
            prefs.lastCheck &&
            now - prefs.lastCheck < MANUAL_CHECK_COOLDOWN
          )
            return snapshot({
              state: state(),
              throttled: true,
              checkedAt: prefs.lastCheck,
            });
          try {
            const result = await fetchLatest({ fetchImpl, currentVersion });
            prefs.cache = {
              release: result.release,
              dshRange: result.dshRange,
              degraded: result.degraded || null,
            };
            prefs.lastCheck = clock();
            await persist();
            return snapshot({
              state: state(),
              checkedAt: prefs.lastCheck,
              dshRange: result.dshRange,
              degraded: result.degraded || null,
            });
          } catch (error) {
            prefs.lastCheck = clock();
            await persist();
            return snapshot({
              state: state(),
              checkedAt: prefs.lastCheck,
              error: { code: error.code || "network", message: error.message },
            });
          }
        }
        return snapshot({ state: state() });
      });
      queue = run.catch(() => {});
      return run;
    },
    async close() {
      await queue;
      await unit.close();
    },
  };
}
