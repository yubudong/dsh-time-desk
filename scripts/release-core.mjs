import { createHash } from "node:crypto";

const number = "(?:0|[1-9]\\d*)";
const pre = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const semver = new RegExp(
  `^v(${number}\\.${number}\\.${number}(?:-${pre}(?:\\.${pre})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?)$`,
);
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export function tagVersion(tag) {
  const match = semver.exec(tag || "");
  if (typeof tag !== "string" || !match || match[0] !== tag)
    throw Error("Expected an exact SemVer tag such as v0.5.1 or v0.5.1-beta.1");
  return match[1];
}
export function repositoryName(manifest) {
  const url =
    typeof manifest.repository === "string"
      ? manifest.repository
      : manifest.repository?.url;
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
      url || "",
    );
  if (!match) throw Error("A canonical GitHub repository is required");
  return match[1];
}
export function validateVersion(tag, manifest, lock) {
  const version = tagVersion(tag);
  if (manifest.name !== "dsh-time-desk")
    throw Error("Unexpected package identity");
  if (
    manifest.version !== version ||
    lock.version !== version ||
    lock.packages?.[""]?.version !== version
  )
    throw Error("Tag, package.json and package-lock.json versions must match");
  if (
    lock.name !== manifest.name ||
    lock.packages?.[""]?.name !== manifest.name
  )
    throw Error("Lockfile package identity does not match");
  return version;
}
export function releaseContext({
  tag,
  manifest,
  lock,
  commit,
  repository,
  notes,
}) {
  const version = validateVersion(tag, manifest, lock);
  if (!/^[a-f0-9]{40}$/.test(commit || ""))
    throw Error("A complete source commit is required");
  const expected = repositoryName(manifest);
  if (repository && repository !== expected)
    throw Error("Publishing repository does not match package metadata");
  if (!notes?.trim() || /\bTODO\b|待填写|REPLACE_ME/.test(notes))
    throw Error("Version-specific release notes are missing or unfinished");
  const versionWithoutBuild = version.split("+")[0];
  return {
    tag,
    version,
    commit,
    repository: expected,
    prerelease: versionWithoutBuild.includes("-"),
    notes: notes.trim(),
  };
}
export function expectedAssets(version) {
  return [
    `dsh-time-desk-${version}.tgz`,
    `dsh-time-desk-${version}-source.zip`,
    "SHA256SUMS.txt",
  ];
}
export function checksumManifest(text, version) {
  const expected = expectedAssets(version).slice(0, 2);
  const values = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})  ([A-Za-z0-9.+_-]+)$/.exec(line);
    if (!m || !expected.includes(m[2]) || values.has(m[2]))
      throw Error("Invalid or unexpected checksum entry");
    values.set(m[2], m[1]);
  }
  if (values.size !== 2) throw Error("Both release archives require checksums");
  return values;
}
async function verifyRemote(api, release, files) {
  const assets = await api.assets(release.id);
  const expected = new Set(files.map((x) => x.name));
  if (assets.some((x) => !expected.has(x.name)))
    throw Error("Release contains unexpected assets; refusing to modify it");
  for (const file of files) {
    const candidates = assets.filter((x) => x.name === file.name);
    if (candidates.length !== 1)
      throw Error("Release asset missing or duplicated: " + file.name);
    const asset = candidates[0];
    if (asset.size !== file.size)
      throw Error("Release asset size mismatch: " + file.name);
    const digest =
      asset.digest || "sha256:" + sha256(await api.download(asset));
    if (digest !== "sha256:" + file.sha256)
      throw Error("Release asset digest mismatch: " + file.name);
  }
}
/** Upload only missing draft assets; never edit or replace published assets. */
export async function publishRelease(context, files, api) {
  const names = expectedAssets(context.version);
  if (
    files.length !== 3 ||
    files.some((x) => !names.includes(x.name)) ||
    new Set(files.map((x) => x.name)).size !== 3
  )
    throw Error("Exactly the expected three assets are required");
  if ((await api.tagCommit(context.tag)) !== context.commit)
    throw Error("Remote tag points to a different commit");
  let release = await api.release(context.tag);
  if (release && !release.draft) {
    if (release.prerelease !== context.prerelease)
      throw Error("Published channel differs from the tag");
    await verifyRemote(api, release, files);
    return {
      url: release.html_url,
      state: "already-published",
      prerelease: context.prerelease,
    };
  }
  if (!release) release = await api.createDraft(context);
  if (!release.draft) throw Error("Expected a draft before uploading");
  if (!release.body?.includes("Source commit: `" + context.commit + "`"))
    throw Error("Existing draft is not bound to this source commit");
  if (release.prerelease !== context.prerelease)
    throw Error("Draft channel differs from the tag");
  const assets = await api.assets(release.id);
  const expected = new Set(names);
  if (assets.some((x) => !expected.has(x.name)))
    throw Error("Unexpected draft asset; manual review required");
  for (const file of files) {
    const matches = assets.filter((x) => x.name === file.name);
    if (matches.length > 1) throw Error("Duplicate draft asset: " + file.name);
    if (matches.length) {
      const asset = matches[0];
      const digest =
        asset.digest || "sha256:" + sha256(await api.download(asset));
      if (asset.size !== file.size || digest !== "sha256:" + file.sha256)
        throw Error(
          "Existing draft asset differs; it will not be overwritten: " +
            file.name,
        );
    } else await api.upload(context.tag, file);
  }
  await verifyRemote(api, release, files);
  // Recheck source and draft state immediately before the public transition.
  if ((await api.tagCommit(context.tag)) !== context.commit)
    throw Error("Tag moved during publication");
  const fresh = await api.releaseById(release.id);
  if (
    !fresh?.draft ||
    fresh.id !== release.id ||
    fresh.tag_name !== context.tag ||
    fresh.prerelease !== context.prerelease ||
    !fresh.body?.includes("Source commit: `" + context.commit + "`")
  )
    throw Error("Release state changed during publication");
  release = await api.publish(release.id, context.prerelease);
  if (release.draft) throw Error("Release remained a draft");
  return {
    url: release.html_url,
    state: "published",
    prerelease: context.prerelease,
  };
}
