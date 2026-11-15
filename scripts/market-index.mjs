import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const status = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).trim();
if (status)
  throw Error(
    "Commit the reviewed source before generating a fixed-commit market candidate.",
  );
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
if (!/^[a-f0-9]{40}$/.test(commit))
  throw Error("A full commit SHA is required.");
const repo = manifest.repository.url.replace(/\.git$/, "");
const index = {
  format: 1,
  title: { zh: "Time Desk 发布候选索引", en: "Time Desk release candidate" },
  description: {
    zh: "仅在仓库与此 Commit 公开可访问后发布。",
    en: "Publish only after the repository and this commit are publicly available.",
  },
  plugins: [
    {
      name: manifest.name,
      title: { zh: "时间工作台", en: "Time desk" },
      description: {
        zh: "项目、习惯、生活安排、农历日程、专注与 AI 时间精灵。",
        en: "Projects, habits, lunar schedules, focus timers and a scoped AI assistant.",
      },
      author: manifest.author,
      homepage: repo,
      repository: { url: repo },
      icon:
        "data:image/svg+xml;base64," +
        Buffer.from(await readFile("icon.svg")).toString("base64"),
      versions: [
        {
          version: manifest.version,
          publishTimestamp: Number(
            execFileSync("git", ["show", "-s", "--format=%ct", "HEAD"], {
              encoding: "utf8",
            }).trim(),
          ),
          engines: { dsh: manifest.engines.dsh },
          source: { type: "git", url: repo + ".git", commit },
        },
      ],
    },
  ],
};
await mkdir("release", { recursive: true });
await writeFile(
  "release/market-index.candidate.json",
  JSON.stringify(index, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    candidate: "release/market-index.candidate.json",
    commit,
    repository: repo,
    remoteAvailability: "not asserted; validate after publishing",
  }),
);
