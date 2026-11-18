import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function privacyIssues(name, bytes) {
  const normalized = name.replaceAll("\\", "/");
  const base = path.posix.basename(normalized);
  const issues = [];
  if (
    /^(?:\.env(?:\..*)?|\.npmrc|\.git-credentials|id_rsa|id_ed25519)$/i.test(
      base,
    ) ||
    /\.(?:jsonl|sqlite(?:3)?|db|log|pem|key|p12|pfx)$/i.test(base)
  )
    issues.push("credential/log/database file");
  if (
    /(?:^|\/)(?:\.dsh|profiles|sessions|backups|logs|private)(?:\/|$)/i.test(
      normalized,
    ) ||
    /^(?:life_desk_v1|life_desk_spirit)\.json$/i.test(base) ||
    /backup.*\.json$/i.test(base)
  )
    issues.push("runtime or backup path");
  if (/(?:^|\/)(?:node_modules|\.git)(?:\/|$)/i.test(normalized))
    issues.push("development/internal path");
  if (/\.(?:png|gif|webp|woff2?)$/i.test(base)) return issues;
  const text = bytes.toString("utf8");
  const checks = [
    ["local home path", /\/(?:Users|home)\/[^\s/"'<>]+\//],
    ["Windows home path", /[A-Z]:[\\/]Users[\\/][^\s\\/"'<>]+[\\/]/i],
    [
      "GitHub credential",
      /(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,})/,
    ],
    ["API credential", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ];
  for (const [label, pattern] of checks)
    if (pattern.test(text)) issues.push(label);
  if (base.endsWith(".json"))
    try {
      const raw = JSON.parse(text);
      const value = raw?.state ?? raw;
      if (
        value?.schemaVersion === 1 &&
        Array.isArray(value.tasks) &&
        Array.isArray(value.habits) &&
        typeof value.deviceId === "string"
      )
        issues.push("serialized personal workspace");
    } catch {}
  return issues;
}
async function walk(root, relative) {
  const full = path.join(root, relative);
  const entries = await readdir(full, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = path.posix.join(relative, e.name);
    if (e.isSymbolicLink())
      throw Error("Symlinks are not allowed in publish source: " + p);
    if (e.isDirectory()) files.push(...(await walk(root, p)));
    else files.push(p);
  }
  return files;
}
export async function audit(root = process.cwd(), { worktree = false } = {}) {
  let files = [],
    basis = "allowlist";
  try {
    files = execFileSync("git", ["ls-files", "--cached", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean);
    if (files.length) basis = worktree ? "git-worktree" : "git-staged";
  } catch {}
  if (!files.length) {
    for (const dir of [
      "src",
      "assets",
      "test",
      "scripts",
      "locale",
      ".github",
      "market",
      "dist",
      "changes",
      "docs",
    ]) {
      try {
        files.push(...(await walk(root, dir)));
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    for (const file of [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "cordis.patch.yml",
      "icon.svg",
      "README.md",
      "RELEASE.md",
      "PRIVACY.md",
      "PUBLISHING.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      ".gitignore",
      ".gitattributes",
    ])
      try {
        await readFile(path.join(root, file));
        files.push(file);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
  }
  const problems = [];
  for (const file of files) {
    const bytes =
      basis === "git-staged"
        ? execFileSync("git", ["show", ":" + file], {
            cwd: root,
            maxBuffer: 16 * 1024 * 1024,
          })
        : await readFile(path.join(root, file));
    for (const issue of privacyIssues(file, bytes))
      problems.push({ file, issue });
  }
  if (problems.length) {
    for (const p of problems) console.error(p.file + ": " + p.issue);
    throw Error("Privacy audit failed; no matched secret values were printed.");
  }
  console.log(
    JSON.stringify({
      privacy: "PASS",
      basis,
      checkedFiles: files.length,
      scope: "source and prebuilt assets; no runtime/profile data selected",
    }),
  );
  return files;
}
export function auditEntries(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 5000)
    throw Error("Invalid archive entry list");
  const seen = new Set();
  for (const { name, base64 } of entries) {
    if (
      typeof name !== "string" ||
      typeof base64 !== "string" ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..") ||
      seen.has(name)
    )
      throw Error("Unsafe or duplicate archive entry");
    seen.add(name);
    const issues = privacyIssues(name, Buffer.from(base64, "base64"));
    if (issues.length) throw Error(name + ": " + issues.join(", "));
  }
  console.log(
    JSON.stringify({
      privacy: "PASS",
      basis: "archive-bytes",
      checkedFiles: entries.length,
    }),
  );
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.includes("--entries-stdin")) {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 64 * 1024 * 1024)
        throw Error("Archive audit input exceeds limit");
      chunks.push(chunk);
    }
    auditEntries(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } else
    await audit(process.cwd(), {
      worktree: process.argv.includes("--worktree"),
    });
}
