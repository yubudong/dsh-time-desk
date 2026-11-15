import test from "node:test";
import assert from "node:assert/strict";
import {
  releaseContext,
  tagVersion,
  checksumManifest,
  publishRelease,
  sha256,
  expectedAssets,
} from "../scripts/release-core.mjs";
import { releaseForTag } from "../scripts/github-api.mjs";
const COMMIT = "a".repeat(40);
test("GitHub drafts are discovered through authenticated listing when tag lookup is 404", async () => {
  const calls = [];
  const draft = { id: 99, tag_name: "v0.5.1", draft: true };
  const request = async (endpoint) => {
    calls.push(endpoint);
    return endpoint.includes("/tags/") ? null : [draft];
  };
  assert.deepEqual(
    await releaseForTag(request, "repos/owner/repo", "v0.5.1"),
    draft,
  );
  assert.equal(calls.length, 2);
});
test("ambiguous draft matches are rejected instead of creating another release", async () => {
  const request = async (endpoint) =>
    endpoint.includes("/tags/")
      ? null
      : [{ tag_name: "v0.5.1" }, { tag_name: "v0.5.1" }];
  await assert.rejects(
    releaseForTag(request, "repos/owner/repo", "v0.5.1"),
    /Multiple releases/,
  );
});
test("final publication uses release ID even when tag lookup hides drafts", async () => {
  const api = fake();
  api.release = async () => null;
  assert.equal(
    (await publishRelease(context(), files(), api)).state,
    "published",
  );
});
function context(version = "0.5.1") {
  return releaseContext({
    tag: "v" + version,
    manifest: {
      name: "dsh-time-desk",
      version,
      repository: { url: "https://github.com/yubudong/dsh-time-desk.git" },
    },
    lock: {
      name: "dsh-time-desk",
      version,
      packages: { "": { name: "dsh-time-desk", version } },
    },
    commit: COMMIT,
    repository: "yubudong/dsh-time-desk",
    notes: "Release notes with upgrade and verification information.",
  });
}
function files(version = "0.5.1") {
  return expectedAssets(version).map((name, i) => {
    const bytes = Buffer.from("archive-" + i);
    return {
      name,
      path: "release/" + name,
      size: bytes.length,
      sha256: sha256(bytes),
      bytes,
    };
  });
}
function fake({
  existing = null,
  remoteAssets = [],
  failUploadAt = 0,
  corruptAfterUpload = false,
  movedTag = false,
} = {}) {
  let release = existing && structuredClone(existing);
  let assets = structuredClone(remoteAssets);
  let count = 0;
  const events = [];
  const api = {
    events,
    get current() {
      return release;
    },
    get stored() {
      return assets;
    },
    async tagCommit() {
      events.push("tag");
      return movedTag && count > 0 ? "b".repeat(40) : COMMIT;
    },
    async release() {
      return release && structuredClone(release);
    },
    async releaseById() {
      return release && structuredClone(release);
    },
    async createDraft(c) {
      events.push("draft");
      release = {
        id: 1,
        draft: true,
        tag_name: c.tag,
        prerelease: c.prerelease,
        body: "Source commit: `" + c.commit + "`",
        html_url: "https://example.test/release",
      };
      return structuredClone(release);
    },
    async assets() {
      return structuredClone(assets);
    },
    async download(a) {
      return Buffer.from(a.bytes);
    },
    async upload(tag, f) {
      count++;
      events.push("upload:" + f.name);
      if (failUploadAt === count) {
        failUploadAt = 0;
        throw Error("network interruption");
      }
      assets.push({
        id: count,
        name: f.name,
        size: f.size,
        digest: "sha256:" + (corruptAfterUpload ? "0".repeat(64) : f.sha256),
        bytes: f.bytes,
      });
    },
    async publish(id, prerelease) {
      events.push("public");
      assert.equal(assets.length, 3);
      release.draft = false;
      release.prerelease = prerelease;
      return structuredClone(release);
    },
  };
  return api;
}
test("strict tag validation accepts stable/prerelease/build and rejects malformed refs", () => {
  for (const tag of ["v0.5.1", "v1.0.0-beta.1", "v1.0.0+build.2"])
    assert.equal(tagVersion(tag), tag.slice(1));
  for (const tag of [
    "main",
    "v1.2",
    "v01.2.3",
    "v1.0.0-beta.01",
    "v1.0.0/../../x",
    "v1.0.0\nextra",
  ])
    assert.throws(() => tagVersion(tag));
});
test("version and lock mismatch stop before publication", () => {
  const c = context();
  const input = {
    tag: c.tag,
    manifest: { name: "dsh-time-desk", version: "0.5.0" },
    lock: { version: "0.5.1" },
    commit: COMMIT,
    notes: "Notes",
  };
  assert.throws(() => releaseContext(input), /versions must match/);
});
test("release identity, source, target repository and finished notes are required", () => {
  const valid = {
    tag: "v0.5.1",
    manifest: {
      name: "dsh-time-desk",
      version: "0.5.1",
      repository: "https://github.com/yubudong/dsh-time-desk.git",
    },
    lock: {
      name: "dsh-time-desk",
      version: "0.5.1",
      packages: { "": { name: "dsh-time-desk", version: "0.5.1" } },
    },
    commit: COMMIT,
    notes: "Notes",
  };
  assert.throws(
    () => releaseContext({ ...valid, repository: "someone/other" }),
    /repository/,
  );
  assert.throws(() => releaseContext({ ...valid, commit: "main" }), /commit/);
  for (const notes of ["", "TODO fill in", "待填写"])
    assert.throws(() => releaseContext({ ...valid, notes }), /notes/);
  assert.equal(context("0.5.1-beta.1").prerelease, true);
  assert.equal(context("0.5.1+build-test").prerelease, false);
});
test("checksum parser rejects missing duplicate foreign and path-traversal assets", () => {
  const good =
    "a".repeat(64) +
    "  dsh-time-desk-0.5.1.tgz\n" +
    "b".repeat(64) +
    "  dsh-time-desk-0.5.1-source.zip\n";
  assert.equal(checksumManifest(good, "0.5.1").size, 2);
  assert.throws(() => checksumManifest(good.split("\n")[0], "0.5.1"));
  assert.throws(() => checksumManifest(good + good.split("\n")[0], "0.5.1"));
  assert.throws(() =>
    checksumManifest(
      good.replace("dsh-time-desk-0.5.1.tgz", "../private.tgz"),
      "0.5.1",
    ),
  );
});
test("release stays draft until all three uploads and digests are verified", async () => {
  const api = fake();
  const result = await publishRelease(context(), files(), api);
  assert.equal(result.state, "published");
  assert.equal(api.events.at(-1), "public");
  assert.equal(api.events.filter((x) => x.startsWith("upload:")).length, 3);
});
test("partial upload is resumable and preserves uploaded asset IDs", async () => {
  const api = fake({ failUploadAt: 2 });
  await assert.rejects(publishRelease(context(), files(), api), /network/);
  assert.equal(api.current.draft, true);
  assert.equal(api.stored.length, 1);
  const first = api.stored[0];
  const result = await publishRelease(context(), files(), api);
  assert.equal(result.state, "published");
  assert.deepEqual(api.stored[0], first);
  assert.equal(
    api.events.filter((x) => x === "upload:" + files()[0].name).length,
    1,
  );
});
test("published release source binding rejects moved tags even if archives are identical", async () => {
  const f = files();
  const api = fake({
    existing: {
      id: 1,
      draft: false,
      prerelease: false,
      body: "Source commit: `" + "b".repeat(40) + "`",
    },
    remoteAssets: f.map((x, i) => ({
      id: i,
      name: x.name,
      size: x.size,
      digest: "sha256:" + x.sha256,
    })),
  });
  await assert.rejects(
    publishRelease(context(), f, api),
    /another source commit/,
  );
  assert.deepEqual(api.events, ["tag"]);
});
test("published release rerun validates and never uploads edits or republishes", async () => {
  const f = files();
  const existing = {
    id: 1,
    draft: false,
    prerelease: false,
    body: "Source commit: `" + COMMIT + "`",
    html_url: "https://example.test/release",
  };
  const api = fake({
    existing,
    remoteAssets: f.map((x, i) => ({
      id: i,
      name: x.name,
      size: x.size,
      digest: "sha256:" + x.sha256,
    })),
  });
  const result = await publishRelease(context(), f, api);
  assert.equal(result.state, "already-published");
  assert.deepEqual(api.events, ["tag"]);
});
test("published or draft conflicting asset content is never overwritten", async () => {
  for (const draft of [false, true]) {
    const c = context();
    const f = files();
    const existing = {
      id: 1,
      draft,
      prerelease: false,
      body: "Source commit: `" + COMMIT + "`",
    };
    const api = fake({
      existing,
      remoteAssets: f.map((x, i) => ({
        id: i,
        name: x.name,
        size: x.size,
        digest: "sha256:" + "0".repeat(64),
      })),
    });
    await assert.rejects(
      publishRelease(c, f, api),
      /digest mismatch|will not be overwritten/,
    );
    assert.ok(!api.events.includes("public"));
    assert.ok(!api.events.some((x) => x.startsWith("upload:")));
  }
});
test("corrupt uploaded bytes or a moved tag cannot be published", async () => {
  const api = fake({ corruptAfterUpload: true });
  await assert.rejects(
    publishRelease(context(), files(), api),
    /digest mismatch/,
  );
  assert.equal(api.current.draft, true);
  const moved = fake({ movedTag: true });
  await assert.rejects(publishRelease(context(), files(), moved), /Tag moved/);
  assert.equal(moved.current.draft, true);
});
test("draft belonging to another source commit is not reused", async () => {
  const api = fake({
    existing: {
      id: 1,
      draft: true,
      prerelease: false,
      body: "Source commit: `" + "b".repeat(40) + "`",
    },
  });
  await assert.rejects(publishRelease(context(), files(), api), /not bound/);
  assert.equal(api.stored.length, 0);
});
test("prereleases retain their channel and cannot silently become stable", async () => {
  const c = context("0.5.1-beta.1"),
    api = fake();
  await publishRelease(c, files(c.version), api);
  assert.equal(api.current.prerelease, true);
  const stable = fake({ existing: { id: 1, draft: false, prerelease: false } });
  await assert.rejects(publishRelease(c, files(c.version), stable), /channel/);
});
test("remote extras or missing public assets require manual review", async () => {
  const f = files(),
    api = fake({
      existing: {
        id: 1,
        draft: false,
        prerelease: false,
        body: "Source commit: `" + COMMIT + "`",
      },
      remoteAssets: [],
    });
  await assert.rejects(publishRelease(context(), f, api), /missing/);
  const draft = fake({
    existing: {
      id: 1,
      draft: true,
      prerelease: false,
      body: "Source commit: `" + COMMIT + "`",
    },
    remoteAssets: [{ name: "unknown.bin" }],
  });
  await assert.rejects(
    publishRelease(context(), f, draft),
    /Unexpected draft asset/,
  );
});
