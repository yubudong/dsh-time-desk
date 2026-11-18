import { tagVersion, repositoryName, expectedAssets } from "./release-core.mjs";
export function marketMaterials({
  tag,
  manifest,
  commit,
  release,
  repository,
}) {
  const version = tagVersion(tag);
  if (
    manifest.name !== "dsh-time-desk" ||
    manifest.version !== version ||
    repositoryName(manifest) !== repository
  )
    throw Error("Market metadata differs from the released package");
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw Error("Market source requires a full commit SHA");
  if (!release || release.draft || release.tag_name !== tag)
    throw Error("Market sync requires a public release");
  const prerelease = version.split("+")[0].includes("-");
  if (release.prerelease !== prerelease)
    throw Error("Market release channel mismatch");
  if (prerelease)
    return {
      skipped: true,
      reason: "Prerelease is not promoted to stable market users",
      version,
      tag,
    };
  const repo = "https://github.com/" + repository;
  if (release.html_url !== repo + "/releases/tag/" + tag)
    throw Error("Unexpected release URL");
  const names = expectedAssets(version);
  for (const name of names) {
    const a = release.assets.find((x) => x.name === name);
    if (
      !a ||
      a.browser_download_url !==
        repo + "/releases/download/" + tag + "/" + name ||
      !/^sha256:[a-f0-9]{64}$/.test(a.digest || "")
    )
      throw Error("Published asset identity/digest missing: " + name);
  }
  const tarball = repo + "/releases/download/" + tag + "/" + names[0];
  const owner = repository.split("/")[0];
  const entryPath = "data/plugins/" + owner + "__dsh-time-desk.yml";
  const yaml = [
    "url: " + repo,
    "name: " + repository,
    "category: workflow",
    "description:",
    "  en: 'A local-first DSH time desk for tasks, rest-aware habits, courses and credit ledgers, with focus timers and a general personal assistant.'",
    "  zh: 'DSH 原生时间工作台：待办、带休息间隔的习惯、课程课时账本与专注计时，内置通用时间精灵助手。'",
    "icon: https://raw.githubusercontent.com/" +
      repository +
      "/" +
      commit +
      "/assets/time-spirit-a.png",
    "tarball: " + tarball,
    "",
  ].join("\n");
  const prBody =
    "## Time Desk " +
    version +
    "\n\nUpdates only `" +
    entryPath +
    "`.\n\n- Release: " +
    release.html_url +
    "\n- Source: `" +
    commit +
    "`\n- Install: " +
    tarball +
    "\n- DSH: `" +
    manifest.engines.dsh +
    "`\n- Prebuilt Host/Client; no install lifecycle scripts.\n- Personal tasks, chats and backups are not included.\n\nThe market still applies its own review and repository-age requirements.\n";
  const storeBody =
    "# DSH STORE 更新材料（不自动新建 Issue）\n\n项目：" +
    repo +
    "\n版本：" +
    version +
    "\n固定 Commit：`" +
    commit +
    "`\n发行版：" +
    release.html_url +
    "\n\n优先等待市场已有的版本扫描与审核；若需要人工补充，可使用这些资料。自动发布不会反复投稿、刷评论或声称已经上架。\n";
  return {
    skipped: false,
    version,
    tag,
    commit,
    repository,
    entryPath,
    yaml,
    prBody,
    storeBody,
    tarball,
    releaseUrl: release.html_url,
  };
}
export function chooseOpenMarketPull(
  pulls,
  { owner, fork, upstream, entryPath },
) {
  const own = pulls.filter(
    (p) =>
      p.state === "open" &&
      p.user?.login === owner &&
      p.head?.repo?.full_name === fork &&
      p.base?.repo?.full_name === upstream,
  );
  if (
    own.some(
      (p) => !p.files?.length || p.files.some((f) => f.filename !== entryPath),
    )
  )
    throw Error(
      "An existing matching PR changes unrelated files; manual review required",
    );
  if (own.length > 1)
    throw Error("Multiple market PRs match; refusing to create another");
  return own[0] || null;
}
export function managedPullBody(oldBody, newBody) {
  const block =
    "<!-- time-desk-release-sync:start -->\n" +
    newBody.trim() +
    "\n<!-- time-desk-release-sync:end -->";
  const regex =
    /<!-- time-desk-release-sync:start -->[\s\S]*?<!-- time-desk-release-sync:end -->/;
  return regex.test(oldBody || "")
    ? oldBody.replace(regex, block)
    : (oldBody?.trim() ? oldBody.trim() + "\n\n" : "") + block;
}
export async function syncMarket(
  materials,
  api,
  {
    tokenConfigured,
    owner,
    upstream = "awesome-dsh-plugin/awesome-dsh-plugin",
  },
) {
  if (materials.skipped) return { state: "skipped-prerelease" };
  if (!tokenConfigured)
    return {
      state: "manual-required",
      reason:
        "MARKET_SYNC_TOKEN is not configured; prepared materials are available",
    };
  if ((await api.identity()) !== owner)
    throw Error("Market token identity differs from the repository owner");
  const fork = owner + "/awesome-dsh-plugin";
  await api.ensureFork(fork, upstream);
  const pulls = await api.matchingPulls(upstream, owner);
  const existing = chooseOpenMarketPull(pulls, {
    owner,
    fork,
    upstream,
    entryPath: materials.entryPath,
  });
  const branch = existing?.head.ref || "update-dsh-time-desk-" + materials.tag;
  if (!existing) await api.ensureBranch(fork, branch, upstream);
  const changed = await api.putEntry(
    fork,
    branch,
    materials.entryPath,
    materials.yaml,
  );
  if (existing) {
    if (changed)
      await api.updatePull(
        upstream,
        existing.number,
        managedPullBody(existing.body, materials.prBody),
      );
    return {
      state: changed ? "updated-existing-pr" : "already-current",
      url: existing.html_url,
    };
  }
  const pr = await api.createPull(upstream, {
    branch,
    owner,
    title: "Update dsh-time-desk to " + materials.version,
    body: managedPullBody("", materials.prBody),
  });
  return { state: "created-pr", url: pr.html_url };
}
