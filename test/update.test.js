import test from "node:test";
import assert from "node:assert/strict";
import {
  compareVersions,
  satisfiesRange,
  sanitizeNotes,
  normalizeRelease,
  updateState,
  expectedAssets,
} from "../src/update-core.js";
import { parseReleaseFeed } from "../src/update-core.js";
import {
  createUpdateService,
  detectInstallKind,
  fetchLatest,
} from "../src/update.js";

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}
function unit(initial = null) {
  let global = initial;
  return {
    async loadAll() {
      return { global, tables: {} };
    },
    async setGlobal(value) {
      global = structuredClone(value);
    },
    async close() {},
    get value() {
      return global;
    },
  };
}
function release(version = "0.5.3", extra = {}) {
  const names = expectedAssets(version);
  return {
    tag_name: "v" + version,
    draft: false,
    prerelease: false,
    html_url:
      "https://github.com/yubudong/dsh-time-desk/releases/tag/v" + version,
    published_at: "2026-11-16T12:00:00Z",
    body: "<b>Fixes</b><script>alert(1)</script> carryover and layout.",
    assets: names.map((name) => ({
      name,
      digest: name === "SHA256SUMS.txt" ? "" : "sha256:" + "a".repeat(64),
      size: 100,
    })),
    ...extra,
  };
}
const manifest = {
  name: "dsh-time-desk",
  version: "0.5.3",
  engines: { dsh: ">=0.2.2-rc.2 <0.3.0" },
};

test("version comparison orders releases and prereleases like SemVer", () => {
  assert.equal(compareVersions("0.5.2", "0.5.3"), -1);
  assert.equal(compareVersions("0.5.3", "0.5.3"), 0);
  assert.equal(compareVersions("0.5.3", "0.6.0"), -1);
  assert.equal(compareVersions("0.5.3-beta.1", "0.5.3"), -1);
  assert.equal(compareVersions("0.5.3-beta.1", "0.5.3-beta.2"), -1);
  assert.equal(compareVersions("0.5.3-rc.1", "0.5.3-beta.9"), 1);
  assert.equal(compareVersions("1.0.0+build.9", "1.0.0+build.1"), 0);
  assert.throws(() => compareVersions("main", "0.5.3"));
});
test("compatibility range handles our declared range and rejects outside versions", () => {
  assert.equal(satisfiesRange("0.2.2-rc.2", ">=0.2.2-rc.2 <0.3.0"), true);
  assert.equal(satisfiesRange("0.2.9", ">=0.2.2-rc.2 <0.3.0"), true);
  assert.equal(satisfiesRange("0.3.0", ">=0.2.2-rc.2 <0.3.0"), false);
  assert.equal(satisfiesRange("0.2.1", ">=0.2.2-rc.2 <0.3.0"), false);
  assert.equal(
    satisfiesRange("0.1.9 || >=0.2.2-rc.2 <0.3.0", ">=0.2.2-rc.2 <0.3.0"),
    null,
  );
  assert.equal(
    satisfiesRange("0.2.2", ">=0.2.2-rc.2 <0.3.0 || >=0.3.0 <0.4.0"),
    true,
  );
  assert.equal(satisfiesRange("0.2.2", "^0.2.1"), true);
  assert.equal(satisfiesRange("0.3.0", "^0.2.1"), false);
  assert.equal(satisfiesRange("0.2.2", "~0.2.1"), true);
  assert.equal(satisfiesRange("weird", ">=0.2.2"), null);
  assert.equal(satisfiesRange("0.2.2", "not a range"), null);
});
test("release notes become inert bounded text", () => {
  const notes = sanitizeNotes(
    "<b>Fixes</b><script>alert(1)</script> carryover and layout.",
  );
  assert.ok(!notes.includes("<"));
  assert.ok(!notes.includes("alert"));
  assert.match(notes, /Fixes/);
  assert.equal(sanitizeNotes(null), "");
  assert.ok(sanitizeNotes("x".repeat(9000)).length <= 4000);
});
test("normalization rejects drafts, prereleases, foreign links and incomplete assets", () => {
  assert.equal(
    normalizeRelease(release(), { currentVersion: "0.5.2" }).newer,
    true,
  );
  assert.throws(
    () => normalizeRelease(release("0.5.3", { draft: true })),
    /草稿/,
  );
  assert.throws(
    () => normalizeRelease(release("0.5.3", { prerelease: true })),
    /预发布/,
  );
  assert.throws(
    () =>
      normalizeRelease(release("0.5.3", { html_url: "https://example.com/x" })),
    /来源异常/,
  );
  const missing = release();
  missing.assets = missing.assets.slice(0, 1);
  assert.throws(() => normalizeRelease(missing), /附件不完整/);
  const noDigest = release();
  noDigest.assets[0].digest = "";
  assert.throws(() => normalizeRelease(noDigest), /校验值/);
});
test("update states distinguish latest, ignored, incompatible and unknown compatibility", () => {
  const base = {
    release: { version: "0.5.3", newer: true },
    currentVersion: "0.5.2",
  };
  assert.deepEqual(updateState({ release: null, currentVersion: "0.5.2" }), {
    kind: "none",
  });
  assert.equal(
    updateState({ ...base, release: { version: "0.5.2", newer: false } }).kind,
    "latest",
  );
  assert.equal(
    updateState({
      release: { version: "0.5.3", newer: true },
      ignoredVersion: "0.5.3",
    }).kind,
    "ignored",
  );
  assert.equal(
    updateState({
      ...base,
      dshRange: ">=0.2.2-rc.2 <0.3.0",
      dshVersion: "0.2.2-rc.2",
    }).kind,
    "available",
  );
  assert.equal(
    updateState({
      ...base,
      dshRange: ">=0.2.2-rc.2 <0.3.0",
      dshVersion: "0.3.0",
    }).kind,
    "incompatible",
  );
  assert.equal(
    updateState({ ...base, dshRange: ">=0.2.2-rc.2 <0.3.0", dshVersion: null })
      .kind,
    "unknown-compat",
  );
  assert.equal(updateState(base).kind, "unknown-compat");
});
test("service persists preferences and caches a verified release", async () => {
  const store = unit();
  const svc = createUpdateService({
    unit: store,
    currentVersion: "0.5.2",
    dshVersion: "0.2.2-rc.2",
    fetchImpl: async (url) =>
      url.includes("api.github.com")
        ? response(200, release())
        : response(200, manifest),
    clock: () => 1000,
  });
  assert.equal((await svc.init()).state.kind, "none");
  assert.equal(
    (await svc.operate({ command: "settings", autoCheck: true })).prefs
      .autoCheck,
    true,
  );
  const checked = await svc.operate({ command: "check" });
  assert.equal(checked.state.kind, "available");
  assert.equal(checked.checkedAt, 1000);
  assert.ok(checked.cache.release.version === "0.5.3");
  assert.equal(store.value.autoCheck, true);
  assert.equal(store.value.cache.release.notes.includes("alert"), false);
  const ignored = await svc.operate({ command: "ignore", version: "0.5.3" });
  assert.equal(ignored.state.kind, "ignored");
  await svc.close();
});
test("reopened preferences survive and cooldown prevents repeat requests", async () => {
  const store = unit({
    autoCheck: true,
    ignoredVersion: "",
    lastCheck: 5000,
    cache: null,
  });
  let calls = 0;
  const svc = createUpdateService({
    unit: store,
    currentVersion: "0.5.2",
    fetchImpl: async (url) => {
      if (url.includes("api.github.com")) calls++;
      return response(
        200,
        url.includes("api.github.com") ? release() : manifest,
      );
    },
    clock: () => 6000,
  });
  const init = await svc.init();
  assert.equal(init.prefs.autoCheck, true);
  assert.equal((await svc.operate({ command: "check" })).throttled, true);
  assert.equal(calls, 0);
  await svc.operate({ command: "check", force: true });
  assert.equal(calls, 1);
  await svc.close();
});
test("network failure is explicit, keeps the previous cache and records the attempt", async () => {
  const store = unit({
    autoCheck: false,
    ignoredVersion: "",
    lastCheck: 0,
    cache: {
      release: { version: "0.5.3", newer: true, notes: "" },
      dshRange: null,
    },
  });
  const svc = createUpdateService({
    unit: store,
    currentVersion: "0.5.2",
    fetchImpl: async () => response(403, {}),
    clock: () => 7000,
  });
  await svc.init();
  const result = await svc.operate({ command: "check", force: true });
  assert.equal(result.error.code, "rate");
  assert.match(result.error.message, /频繁/);
  assert.equal(result.state.kind, "unknown-compat");
  assert.equal(result.checkedAt, 7000);
  await svc.close();
});
test("install kind is reported without exposing local paths", () => {
  const kind = detectInstallKind();
  assert.ok(["development", "managed", "unknown"].includes(kind));
});

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.5.2</id>
    <updated>2026-11-15T10:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/yubudong/dsh-time-desk/releases/tag/v0.5.2"/>
    <title>0.5.2</title>
    <content type="html">&lt;p&gt;Older note&lt;/p&gt;</content>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.5.3</id>
    <updated>2026-11-16T12:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/yubudong/dsh-time-desk/releases/tag/v0.5.3"/>
    <title>0.5.3</title>
    <content type="html">&lt;p&gt;Newer &amp;amp; safe note&lt;/p&gt;&lt;script&gt;x&lt;/script&gt;</content>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.5.4-beta.1</id>
    <updated>2026-11-17T12:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/yubudong/dsh-time-desk/releases/tag/v0.5.4-beta.1"/>
    <title>beta</title>
    <content type="html">prerelease</content>
  </entry>
</feed>`;
test("release feed selects the highest stable entry and marks assets unverified", () => {
  const release = parseReleaseFeed(feed, { currentVersion: "0.5.2" });
  assert.equal(release.version, "0.5.3");
  assert.equal(release.newer, true);
  assert.equal(release.assetsVerified, false);
  assert.match(release.notes, /Newer/);
  assert.match(release.notes, /&/);
  assert.ok(!release.notes.includes("<"));
  assert.equal(
    release.url,
    "https://github.com/yubudong/dsh-time-desk/releases/tag/v0.5.3",
  );
});
test("rate-limited API falls back to the public feed and still reports compatibility", async () => {
  const result = await fetchLatest({
    currentVersion: "0.5.2",
    fetchImpl: async (url) => {
      if (url.includes("api.github.com")) return response(403, {});
      if (url.includes("releases.atom")) return response(200, feed);
      return response(200, { ...manifest, version: "0.5.3" });
    },
  });
  assert.equal(result.degraded, "feed");
  assert.equal(result.release.version, "0.5.3");
  assert.equal(result.release.assetsVerified, false);
  assert.equal(result.dshRange, ">=0.2.2-rc.2 <0.3.0");
});
test("non-rate API failures do not silently fall back", async () => {
  await assert.rejects(
    fetchLatest({
      currentVersion: "0.5.2",
      fetchImpl: async () => response(500, {}),
    }),
    /HTTP 500/,
  );
});
