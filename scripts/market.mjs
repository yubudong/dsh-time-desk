import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { githubApi } from "./github-api.mjs";
import { tagVersion, repositoryName } from "./release-core.mjs";
import { marketMaterials, syncMarket } from "./market-core.mjs";
const command = process.argv[2];
const i = process.argv.indexOf("--tag");
let tag = i >= 0 ? process.argv[i + 1] : process.env.RELEASE_TAG;
const directory = "release/market";
async function summary(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, text + "\n");
}
async function prepare() {
  const local = JSON.parse(await readFile("package.json", "utf8"));
  const repository = process.env.GITHUB_REPOSITORY || repositoryName(local);
  if (repository !== repositoryName(local))
    throw Error("Market workflow repository mismatch");
  let plan;
  if (!tag) {
    plan = JSON.parse(await readFile("release/release-plan.json", "utf8"));
    tag = plan.tag;
    if (plan.repository !== repository)
      throw Error("Untrusted release plan repository");
  }
  tagVersion(tag);
  const api = githubApi(repository);
  const commit = await api.tagCommit(tag);
  if (plan && plan.commit !== commit)
    throw Error("Tag differs from release workflow candidate");
  const release = await api.release(tag);
  if (!release || release.draft) throw Error("Release is not public");
  const file = api.request(
    "repos/" + repository + "/contents/package.json?ref=" + commit,
  );
  if (file.type !== "file" || file.encoding !== "base64" || file.size > 65536)
    throw Error("Unexpected remote package manifest");
  const manifest = JSON.parse(
    Buffer.from(file.content, "base64").toString("utf8"),
  );
  const materials = marketMaterials({
    tag,
    manifest,
    commit,
    release,
    repository,
  });
  await mkdir(directory, { recursive: true });
  if (!materials.skipped) {
    await writeFile(directory + "/awesome-entry.yml", materials.yaml);
    await writeFile(directory + "/awesome-pr.md", materials.prBody);
    await writeFile(directory + "/dsh-store-update.md", materials.storeBody);
  }
  await writeFile(
    directory + "/materials.json",
    JSON.stringify(materials, null, 2) + "\n",
  );
  await summary(
    materials.skipped
      ? "## Market sync\n\nSkipped: prerelease; stable users are not promoted to this test version."
      : "## Market materials\n\nPrepared " +
          materials.version +
          " for " +
          materials.releaseUrl +
          ". Market review is separate from GitHub publication.",
  );
  return materials;
}
function marketAdapter(materials, token) {
  const api = githubApi(materials.repository, { token });
  const owner = materials.repository.split("/")[0];
  let identity;
  return {
    async identity() {
      const user = api.request("user");
      identity = {
        name: user.login,
        email: user.id + "+" + user.login + "@users.noreply.github.com",
      };
      return user.login;
    },
    async ensureFork(fork, upstream) {
      let r = api.request("repos/" + fork, { missing: true });
      if (!r)
        r = api.request("repos/" + upstream + "/forks", {
          method: "POST",
          body: { default_branch_only: true },
        });
      if (!r.fork || r.parent?.full_name !== upstream)
        throw Error("Target repository is not the expected fork");
    },
    async matchingPulls(upstream, user) {
      const q = `repo:${upstream} is:pr is:open author:${user} in:title dsh-time-desk`;
      const search = api.request(
        "search/issues?q=" + encodeURIComponent(q) + "&per_page=30",
      );
      if (search.total_count > 30)
        throw Error("Too many matching PRs; manual review required");
      return search.items.map((x) => {
        const p = api.request("repos/" + upstream + "/pulls/" + x.number);
        p.files = api.request(
          "repos/" + upstream + "/pulls/" + x.number + "/files?per_page=100",
        );
        if (p.changed_files > 100) throw Error("Market PR scope exceeds bound");
        return p;
      });
    },
    async ensureBranch(fork, branch, upstream) {
      const endpoint =
        "repos/" + fork + "/git/ref/heads/" + encodeURIComponent(branch);
      const ref = api.request(endpoint, { missing: true });
      if (ref) {
        const past = api.request(
          "repos/" +
            upstream +
            "/pulls?state=all&head=" +
            encodeURIComponent(owner + ":" + branch),
        );
        if (past.length)
          throw Error(
            "Version branch already had a PR; manual review required",
          );
        const diff = api.request(
          "repos/" +
            upstream +
            "/compare/main..." +
            encodeURIComponent(owner + ":" + branch),
        );
        if (diff.files.some((x) => x.filename !== materials.entryPath))
          throw Error("Existing version branch changes unrelated files");
        return;
      }
      const sha = api.request("repos/" + upstream + "/git/ref/heads/main")
        .object.sha;
      api.request("repos/" + fork + "/git/refs", {
        method: "POST",
        body: { ref: "refs/heads/" + branch, sha },
      });
    },
    async putEntry(fork, branch, entry, yaml) {
      const endpoint = "repos/" + fork + "/contents/" + entry;
      const existing = api.request(
        endpoint + "?ref=" + encodeURIComponent(branch),
        { missing: true },
      );
      if (existing && existing.type !== "file")
        throw Error("Market entry is not a file");
      if (
        existing &&
        Buffer.from(existing.content, "base64").toString("utf8") === yaml
      )
        return false;
      api.request(endpoint, {
        method: "PUT",
        body: {
          message: "Update dsh-time-desk to " + materials.version,
          branch,
          content: Buffer.from(yaml).toString("base64"),
          ...(existing ? { sha: existing.sha } : {}),
          author: identity,
          committer: identity,
        },
      });
      return true;
    },
    async updatePull(upstream, number, body) {
      api.request("repos/" + upstream + "/pulls/" + number, {
        method: "PATCH",
        body: { body },
      });
    },
    async createPull(upstream, { branch, owner, title, body }) {
      return api.request("repos/" + upstream + "/pulls", {
        method: "POST",
        body: { head: owner + ":" + branch, base: "main", title, body },
      });
    },
  };
}
try {
  if (command === "prepare") await prepare();
  else if (command === "submit") {
    const materials = JSON.parse(
      await readFile(directory + "/materials.json", "utf8"),
    );
    const token = process.env.MARKET_SYNC_TOKEN;
    const result = await syncMarket(
      materials,
      token && !materials.skipped ? marketAdapter(materials, token) : null,
      { tokenConfigured: !!token, owner: materials.repository?.split("/")[0] },
    );
    await writeFile(
      directory + "/sync-result.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    await summary(
      "## Market sync result\n\n" +
        result.state +
        (result.url ? " — " + result.url : "") +
        "\n\n" +
        (result.reason || "") +
        "\n\nDSH STORE: use its existing scan/review process. No duplicate Issue or repeated comment was created.",
    );
  } else
    throw Error(
      "Usage: node scripts/market.mjs prepare|submit [--tag vVERSION]",
    );
} catch (e) {
  await summary(
    "## Market sync needs attention\n\n" +
      e.message +
      "\n\nPrepared files, if any, remain downloadable. A market failure does not roll back or overwrite the GitHub release.",
  );
  process.exitCode = 1;
}
