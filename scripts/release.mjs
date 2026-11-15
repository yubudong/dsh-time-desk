import {
  readFile,
  appendFile,
  writeFile,
  mkdir,
  lstat,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  releaseContext,
  validateVersion,
  expectedAssets,
  checksumManifest,
  sha256,
  publishRelease,
} from "./release-core.mjs";
import { githubApi } from "./github-api.mjs";
const command = process.argv[2];
const index = process.argv.indexOf("--tag");
const tag = index >= 0 ? process.argv[index + 1] : process.env.RELEASE_TAG;
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
async function context() {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
  // Validate tag before using it in any path or command.
  const version = validateVersion(tag, manifest, lock);
  const notesFile = "changes/" + version + ".md";
  const stat = await lstat(notesFile).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink())
    throw Error("Missing regular release notes file: " + notesFile);
  git("ls-files", "--error-unmatch", notesFile);
  const commit = git("rev-parse", "HEAD");
  if (git("rev-parse", tag + "^{commit}") !== commit)
    throw Error("Checkout is not the tagged commit");
  if (git("status", "--porcelain", "--untracked-files=no"))
    throw Error("Tracked source must be clean, including rebuilt dist");
  return releaseContext({
    tag,
    manifest,
    lock,
    commit,
    repository: process.env.GITHUB_REPOSITORY,
    notes: await readFile(notesFile, "utf8"),
  });
}
async function filesFor(c) {
  const names = expectedAssets(c.version),
    root = path.resolve("release");
  const files = [];
  for (const name of names) {
    const p = path.join(root, name);
    const stat = await lstat(p);
    if (!stat.isFile() || stat.isSymbolicLink() || (await realpath(p)) !== p)
      throw Error("Release assets must be regular files under release/");
    const bytes = await readFile(p);
    files.push({ name, path: p, size: bytes.length, sha256: sha256(bytes) });
  }
  const checks = checksumManifest(
    await readFile(path.join(root, "SHA256SUMS.txt"), "utf8"),
    c.version,
  );
  for (const f of files.slice(0, 2))
    if (checks.get(f.name) !== f.sha256)
      throw Error("Local archive checksum mismatch: " + f.name);
  return files;
}
async function output(values) {
  for (const [key, value] of Object.entries(values)) {
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
  console.log(JSON.stringify(values));
}
try {
  const c = await context();
  if (command === "check") {
    await output({
      tag: c.tag,
      version: c.version,
      commit: c.commit,
      prerelease: String(c.prerelease),
    });
  } else if (command === "verify") {
    const files = await filesFor(c);
    await mkdir("release", { recursive: true });
    await writeFile(
      "release/release-plan.json",
      JSON.stringify(
        {
          tag: c.tag,
          version: c.version,
          commit: c.commit,
          repository: c.repository,
          prerelease: c.prerelease,
          notesSha256: sha256(c.notes),
          assets: files.map(({ name, size, sha256 }) => ({
            name,
            size,
            sha256,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    await output({ verified: true, tag: c.tag });
  } else if (command === "publish") {
    const files = await filesFor(c);
    const plan = JSON.parse(
      await readFile("release/release-plan.json", "utf8"),
    );
    if (
      plan.tag !== c.tag ||
      plan.commit !== c.commit ||
      plan.repository !== c.repository ||
      plan.notesSha256 !== sha256(c.notes) ||
      JSON.stringify(plan.assets) !==
        JSON.stringify(
          files.map(({ name, size, sha256 }) => ({ name, size, sha256 })),
        )
    )
      throw Error("Downloaded candidate does not match this tagged source");
    const result = await publishRelease(c, files, githubApi(c.repository));
    await output({
      url: result.url,
      state: result.state,
      prerelease: String(result.prerelease),
    });
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## Time Desk ${c.version}\n\n- Release: ${result.url}\n- State: ${result.state}\n- Source: \`${c.commit}\`\n- Channel: ${c.prerelease ? "prerelease (stable Latest unchanged)" : "stable"}\n- Three assets verified before publication; published assets were not overwritten.\n`,
      );
  } else
    throw Error(
      "Usage: node scripts/release.mjs check|verify|publish --tag vVERSION",
    );
} catch (error) {
  console.error("Release blocked: " + error.message);
  process.exitCode = 1;
}
