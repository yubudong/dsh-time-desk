// Pure update-discovery rules. Network and storage live in update.js.
export const UPDATE_REPOSITORY = "yubudong/dsh-time-desk";
export const UPDATE_API =
  "https://api.github.com/repos/" + UPDATE_REPOSITORY + "/releases/latest";
export const UPDATE_PAGE =
  "https://github.com/" + UPDATE_REPOSITORY + "/releases";
export const UPDATE_FEED =
  "https://github.com/" + UPDATE_REPOSITORY + "/releases.atom";
export const AUTO_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
export const MANUAL_CHECK_COOLDOWN = 30 * 1000;
export const MAX_NOTES = 4000;

const VERSION =
  /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
export function parseVersion(value) {
  if (typeof value !== "string") return null;
  const m = VERSION.exec(value.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".") : [],
  };
}
const numeric = (x) => /^[0-9]+$/.test(x);
function compareIdentifier(a, b) {
  const na = numeric(a),
    nb = numeric(b);
  if (na && nb) return Number(a) - Number(b);
  if (na) return -1;
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
export function compareVersions(a, b) {
  const x = parseVersion(a),
    y = parseVersion(b);
  if (!x || !y) throw Error("Invalid version");
  for (const k of ["major", "minor", "patch"])
    if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.prerelease.length && !y.prerelease.length) return 0;
  if (!x.prerelease.length) return 1;
  if (!y.prerelease.length) return -1;
  const n = Math.max(x.prerelease.length, y.prerelease.length);
  for (let i = 0; i < n; i++) {
    if (!x.prerelease[i]) return -1;
    if (!y.prerelease[i]) return 1;
    const c = compareIdentifier(x.prerelease[i], y.prerelease[i]);
    if (c) return c < 0 ? -1 : 1;
  }
  return 0;
}
const bound = (p, zeroPrerelease) =>
  `${p.major}.${p.minor}.${p.patch}${zeroPrerelease ? "-0" : ""}`;
function comparatorRange(token) {
  const m = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token);
  const op = m[1] || "=";
  const v = parseVersion(m[2]);
  if (!v) return null;
  if (op === "=") return { test: (x) => compareVersions(x, m[2]) === 0 };
  if (op === "^") {
    const upper =
      v.major > 0
        ? `${v.major + 1}.0.0-0`
        : v.minor > 0
          ? `0.${v.minor + 1}.0-0`
          : `0.0.${v.patch + 1}-0`;
    return {
      test: (x) =>
        compareVersions(x, m[2]) >= 0 && compareVersions(x, upper) < 0,
    };
  }
  if (op === "~") {
    const upper = `${v.major}.${v.minor + 1}.0-0`;
    return {
      test: (x) =>
        compareVersions(x, m[2]) >= 0 && compareVersions(x, upper) < 0,
    };
  }
  const test = {
    ">=": (x) => compareVersions(x, m[2]) >= 0,
    ">": (x) => compareVersions(x, m[2]) > 0,
    "<=": (x) => compareVersions(x, m[2]) <= 0,
    "<": (x) => compareVersions(x, m[2]) < 0,
  }[op];
  return test ? { test } : null;
}
/** Deliberately a small comparator subset; it advises, it never gates install. */
export function satisfiesRange(version, range) {
  if (!parseVersion(version) || typeof range !== "string" || !range.trim())
    return null;
  const branches = range
    .split("||")
    .map((b) => b.trim())
    .filter(Boolean);
  if (!branches.length) return null;
  const parsed = [];
  for (const branch of branches) {
    const comparators = branch.split(/\s+/).map(comparatorRange);
    if (comparators.some((c) => !c)) return null;
    parsed.push(comparators);
  }
  return parsed.some((list) => list.every((c) => c.test(version)));
}
export function expectedAssets(version) {
  return [
    `dsh-time-desk-${version}.tgz`,
    `dsh-time-desk-${version}-source.zip`,
    "SHA256SUMS.txt",
  ];
}
/** Strip HTML/script content so release notes stay inert text. */
export function sanitizeNotes(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, MAX_NOTES);
}
export function normalizeRelease(
  json,
  { currentVersion, allowUnverified = false } = {},
) {
  if (!json || typeof json !== "object") throw Error("发布信息格式无法识别");
  if (json.draft) throw Error("该发布仍是草稿");
  if (json.prerelease) throw Error("只检查稳定版，该发布是预发布版");
  const version = String(json.tag_name || "").replace(/^v/, "");
  if (!parseVersion(version)) throw Error("发布版本号无法识别");
  if (!json.html_url || !/^https:\/\/github\.com\//.test(json.html_url))
    throw Error("发布链接来源异常");
  const names = expectedAssets(version);
  const source = Array.isArray(json.assets) ? json.assets : [];
  const present = new Set(source.map((a) => a?.name));
  const missing = names.filter((n) => !present.has(n));
  const assetsVerified = missing.length === 0;
  if (!assetsVerified && !allowUnverified)
    throw Error("发布附件不完整：" + missing.join("、"));
  if (assetsVerified) {
    const badDigest = source.find(
      (a) =>
        names.includes(a.name) &&
        a.name !== "SHA256SUMS.txt" &&
        !/^sha256:[a-f0-9]{64}$/.test(a.digest || ""),
    );
    if (badDigest) throw Error("发布附件缺少校验值：" + badDigest.name);
  }
  return {
    version,
    url: json.html_url,
    publishedAt: json.published_at || "",
    notes: sanitizeNotes(json.body),
    assetsVerified,
    assets: source
      .filter((a) => names.includes(a?.name))
      .map((a) => ({
        name: a.name,
        digest: a.digest || "",
        size: a.size || 0,
      })),
    newer: currentVersion ? compareVersions(version, currentVersion) > 0 : true,
  };
}
const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
/** Fallback only when the anonymous API is rate limited: same repo, one entry. */
export function parseReleaseFeed(xml, { currentVersion } = {}) {
  if (typeof xml !== "string" || xml.length > 512 * 1024)
    throw Error("发布订阅内容无法识别");
  let best = null;
  let bestVersion = null;
  for (const [, entry] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const href = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(entry);
    if (!href || !/\/releases\/tag\/v[^"]+$/.test(href[1])) continue;
    const version = href[1].split("/tag/v")[1];
    const parsed = parseVersion(version);
    if (!parsed || parsed.prerelease.length) continue;
    const updated = /<updated>([^<]+)<\/updated>/.exec(entry);
    const content = /<content[^>]*>([\s\S]*?)<\/content>/.exec(entry);
    if (!best || compareVersions(version, bestVersion) > 0) {
      bestVersion = version;
      best = {
        tag_name: "v" + version,
        html_url: href[1],
        published_at: updated ? updated[1] : "",
        body: content ? decodeEntities(content[1]) : "",
        assets: [],
        draft: false,
        prerelease: false,
      };
    }
  }
  if (!best) throw Error("发布订阅中没有稳定版本");
  return normalizeRelease(best, { currentVersion, allowUnverified: true });
}
export function updateState({
  release,
  currentVersion,
  dshVersion,
  dshRange,
  ignoredVersion,
}) {
  if (!release) return { kind: "none" };
  if (!release.newer) return { kind: "latest", version: release.version };
  if (ignoredVersion && ignoredVersion === release.version)
    return { kind: "ignored", version: release.version };
  if (!dshRange) return { kind: "unknown-compat", version: release.version };
  const ok = dshVersion ? satisfiesRange(dshVersion, dshRange) : null;
  if (ok === false)
    return {
      kind: "incompatible",
      version: release.version,
      dshRange,
      dshVersion,
    };
  if (ok === null)
    return { kind: "unknown-compat", version: release.version, dshRange };
  return { kind: "available", version: release.version, dshRange };
}
export function formatVersion(version) {
  return version ? "v" + String(version).replace(/^v/, "") : "";
}
