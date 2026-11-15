import test from "node:test";
import assert from "node:assert/strict";
import {
  marketMaterials,
  chooseOpenMarketPull,
  managedPullBody,
  syncMarket,
} from "../scripts/market-core.mjs";
import { expectedAssets } from "../scripts/release-core.mjs";
const repository = "yubudong/dsh-time-desk",
  commit = "a".repeat(40),
  repo = "https://github.com/" + repository;
const upstream = "awesome-dsh-plugin/awesome-dsh-plugin",
  fork = "yubudong/awesome-dsh-plugin",
  entryPath = "data/plugins/yubudong__dsh-time-desk.yml";
function fixture(version = "0.5.1") {
  const tag = "v" + version;
  return {
    tag,
    repository,
    commit,
    manifest: {
      name: "dsh-time-desk",
      version,
      repository: repo + ".git",
      engines: { dsh: ">=0.2.2-rc.2 <0.3.0" },
    },
    release: {
      tag_name: tag,
      draft: false,
      prerelease: version.includes("-"),
      html_url: repo + "/releases/tag/" + tag,
      assets: expectedAssets(version).map((name) => ({
        name,
        browser_download_url: repo + "/releases/download/" + tag + "/" + name,
        digest: "sha256:" + "b".repeat(64),
      })),
    },
  };
}
function pull(overrides = {}) {
  return {
    number: 15494,
    state: "open",
    user: { login: "yubudong" },
    head: { ref: "initial-entry", repo: { full_name: fork } },
    base: { repo: { full_name: upstream } },
    files: [{ filename: entryPath }],
    body: "Original submission context",
    html_url: "https://example.test/pr",
    ...overrides,
  };
}
function fake({ pulls = [], changed = true, identity = "yubudong" } = {}) {
  const calls = [];
  return {
    calls,
    async identity() {
      calls.push("identity");
      return identity;
    },
    async ensureFork() {
      calls.push("fork");
    },
    async matchingPulls() {
      return pulls;
    },
    async ensureBranch() {
      calls.push("branch");
    },
    async putEntry() {
      calls.push("entry");
      return changed;
    },
    async updatePull(r, n, body) {
      calls.push({ update: n, body });
    },
    async createPull() {
      calls.push("create");
      return { html_url: "https://example.test/new" };
    },
  };
}
test("stable market materials point at version-pinned archives and source icons", () => {
  const m = marketMaterials(fixture());
  assert.ok(
    m.yaml.includes("/releases/download/v0.5.1/dsh-time-desk-0.5.1.tgz"),
  );
  assert.ok(m.yaml.includes("/" + commit + "/assets/"));
  assert.equal(m.entryPath, entryPath);
  assert.ok(!m.yaml.includes("latest/download"));
  assert.ok(m.storeBody.includes("不自动新建 Issue"));
});
test("prereleases are not promoted to stable market users", async () => {
  const m = marketMaterials(fixture("0.5.1-beta.1"));
  assert.equal(m.skipped, true);
  assert.equal(
    (await syncMarket(m, null, { tokenConfigured: false })).state,
    "skipped-prerelease",
  );
});
test("drafts, incorrect manifests and foreign assets are rejected", () => {
  const x = fixture();
  assert.throws(
    () => marketMaterials({ ...x, release: { ...x.release, draft: true } }),
    /public release/,
  );
  assert.throws(
    () =>
      marketMaterials({ ...x, manifest: { ...x.manifest, version: "0.5.0" } }),
    /metadata/,
  );
  const bad = structuredClone(x);
  bad.release.assets[0].browser_download_url =
    "https://example.test/archive.tgz";
  assert.throws(() => marketMaterials(bad), /asset identity/);
});
test("missing authorization generates a manual-required result without API calls", async () => {
  const result = await syncMarket(marketMaterials(fixture()), null, {
    tokenConfigured: false,
    owner: "yubudong",
  });
  assert.equal(result.state, "manual-required");
  assert.ok(result.reason.includes("MARKET_SYNC_TOKEN"));
});
test("an existing initial submission is updated instead of opening another PR", async () => {
  const api = fake({ pulls: [pull()] });
  const result = await syncMarket(marketMaterials(fixture()), api, {
    tokenConfigured: true,
    owner: "yubudong",
  });
  assert.equal(result.state, "updated-existing-pr");
  assert.ok(!api.calls.includes("create"));
  assert.ok(!api.calls.includes("branch"));
  const update = api.calls.find((x) => typeof x === "object");
  assert.equal(update.update, 15494);
  assert.ok(update.body.startsWith("Original submission context"));
});
test("identical rerun does not create PRs or update bodies again", async () => {
  const api = fake({ pulls: [pull()], changed: false });
  assert.equal(
    (
      await syncMarket(marketMaterials(fixture()), api, {
        tokenConfigured: true,
        owner: "yubudong",
      })
    ).state,
    "already-current",
  );
  assert.ok(!api.calls.some((x) => x === "create" || typeof x === "object"));
});
test("a new PR is created only when no matching owned open PR exists", async () => {
  const api = fake();
  const result = await syncMarket(marketMaterials(fixture()), api, {
    tokenConfigured: true,
    owner: "yubudong",
  });
  assert.equal(result.state, "created-pr");
  assert.equal(api.calls.filter((x) => x === "create").length, 1);
});
test("unrelated files, ambiguous PRs and incorrect credentials stop market writes", async () => {
  const scope = { owner: "yubudong", fork, upstream, entryPath };
  assert.throws(
    () =>
      chooseOpenMarketPull(
        [pull({ files: [{ filename: "README.md" }] })],
        scope,
      ),
    /unrelated/,
  );
  assert.throws(
    () => chooseOpenMarketPull([pull(), pull({ number: 2 })], scope),
    /Multiple/,
  );
  const api = fake({ identity: "another-account" });
  await assert.rejects(
    syncMarket(marketMaterials(fixture()), api, {
      tokenConfigured: true,
      owner: "yubudong",
    }),
    /identity/,
  );
  assert.deepEqual(api.calls, ["identity"]);
});
test("managed PR section preserves prior text and is replaced without duplication", () => {
  const once = managedPullBody("Original review context", "Version 1");
  const twice = managedPullBody(once, "Version 2");
  assert.ok(twice.startsWith("Original review context"));
  assert.ok(!twice.includes("Version 1"));
  assert.equal(twice.match(/time-desk-release-sync:start/g).length, 1);
});
