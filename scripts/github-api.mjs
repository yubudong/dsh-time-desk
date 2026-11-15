import { execFileSync } from "node:child_process";

export function githubApi(repository, { token = process.env.GH_TOKEN } = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw Error("Invalid GitHub repository");
  const env = { ...process.env, ...(token ? { GH_TOKEN: token } : {}) };
  function request(
    endpoint,
    { method = "GET", body, missing = false, binary = false } = {},
  ) {
    const args = ["api", endpoint, "--method", method];
    if (body !== undefined) args.push("--input", "-");
    if (binary) args.push("-H", "Accept: application/octet-stream");
    try {
      const out = execFileSync("gh", args, {
        input: body === undefined ? undefined : JSON.stringify(body),
        encoding: binary ? undefined : "utf8",
        env,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return binary ? out : out.trim() ? JSON.parse(out) : null;
    } catch (e) {
      const stderr = String(e.stderr || "");
      if (missing && stderr.includes("HTTP 404")) return null;
      throw Error(
        `GitHub ${method} ${endpoint} failed: ${stderr.slice(0, 900)}`,
      );
    }
  }
  const prefix = "repos/" + repository;
  return {
    request,
    async tagCommit(tag) {
      return request(prefix + "/commits/" + encodeURIComponent(tag)).sha;
    },
    async release(tag) {
      return request(prefix + "/releases/tags/" + encodeURIComponent(tag), {
        missing: true,
      });
    },
    async createDraft(c) {
      return request(prefix + "/releases", {
        method: "POST",
        body: {
          tag_name: c.tag,
          target_commitish: c.commit,
          name: "Time Desk " + c.version,
          body: c.notes + "\n\nSource commit: `" + c.commit + "`\n",
          draft: true,
          prerelease: c.prerelease,
          make_latest: "false",
        },
      });
    },
    async assets(id) {
      return request(prefix + "/releases/" + id + "/assets?per_page=100");
    },
    async download(asset) {
      return request(prefix + "/releases/assets/" + asset.id, { binary: true });
    },
    async upload(tag, file) {
      try {
        execFileSync(
          "gh",
          ["release", "upload", tag, file.path, "--repo", repository],
          { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (e) {
        throw Error(
          "Draft upload failed for " +
            file.name +
            ": " +
            String(e.stderr || "").slice(0, 700),
        );
      }
    },
    async publish(id, prerelease) {
      return request(prefix + "/releases/" + id, {
        method: "PATCH",
        body: {
          draft: false,
          prerelease,
          make_latest: prerelease ? "false" : "legacy",
        },
      });
    },
  };
}
