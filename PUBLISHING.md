# 自动发布与市场同步

项目：<https://github.com/yubudong/dsh-time-desk>。

第一期实现自动发版与市场材料／PR，不包含用户侧更新检查、自动安装或工作台界面改动。GitHub 发版成功与市场审核通过是两种状态。

## 正常发一个新版本

以下以尚未发布的 `0.5.1` 为例；不要重用已经公开的标签或版本：

```sh
npm version 0.5.1 --no-git-tag-version --ignore-scripts
```

复制 `changes/TEMPLATE.md` 为 `changes/0.5.1.md`，填写新增、修复、数据升级和验证／限制，删掉所有占位项。然后：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run build
npm test
git add -- package.json package-lock.json src assets dist changes test
npm run privacy
git diff --cached --stat
# 逐项复核内容，再提交；不要提交自己的数据和截图。
git commit -m "Release 0.5.1"
git tag v0.5.1
git push origin main
git push origin v0.5.1
```

必须提交同步生成的 `dist`。发布检查会重建并比较它，避免 Git 安装得到旧程序。普通分支提交只运行 CI，只有 `v*` 标签触发发布。

## 发布流程

`Publish Time Desk` 按以下顺序执行：

1. 核对精确 SemVer 标签、包清单、锁文件版本和包名；核对仓库、完整 Commit、已提交且无占位内容的版本说明。
2. macOS／Windows／Linux × Node 22／24：隐私检查、类型检查、构建、预构建文件一致性、生成文件隐私检查、自动测试和打包检查。
3. 固定 Node 22 和 Python 3.12 构建 TGZ、源码 ZIP 与 SHA-256 清单；只选择允许的 Git 跟踪文件，源码 ZIP 使用提交时间构造确定性元数据。
4. 检查完整源码与归档字节，不只检查暂存区；隔离导入 Host 包，核对包名、版本与文件路径。
5. 上传候选构建到本次 Actions Artifact，供有写入权限的发布任务下载。测试／构建任务没有仓库写权限，也不持有市场投稿凭据。
6. 建立草稿 Release，上传缺失附件，核对文件名、大小和摘要，再次核对标签 Commit，最后公开。

安装包、源码包和 `SHA256SUMS.txt` 必须同时完整。失败时不会自动公开残缺版本；候选构建保留 14 天。

## 测试版

版本与标签使用 `0.5.1-beta.1`／`v0.5.1-beta.1`。它会被标记为 Pre-release，不替换稳定版 Latest，不更新市场稳定安装入口。测试版同样执行完整检查，不能省略更新说明。

构建元数据（如 `+build.1`）不是测试版标记。需要测试通道时必须使用 SemVer 的 `-beta.N` 等预发布部分。

## 上传中断与重试

可以在 Actions 的 `Publish Time Desk` 中选择 Run workflow 并填入原标签，或：

```sh
gh workflow run release.yml -f tag=v0.5.1
```

- 未建立草稿：通过检查后创建。
- 草稿已有部分附件：只补传缺失附件，已有附件摘要必须一致。
- 已公开：只检查，返回 `already-published`，不编辑说明、不替换附件、不再公开一次。
- 同名附件内容不同、标签移动、通道不一致、未知附件或来源不匹配：停止，保留当前状态供人工核对。不要使用 `--clobber` 掩盖问题。

同一标签的任务串行执行，不取消正在运行的发布。重新构建必须得到相同字节；运行环境变化导致摘要不同也会停止，不会覆盖已公开资产。

0.5.0 是此前手工发布版本，不含本流程的标签内脚本和版本说明；不要尝试用本流程覆盖它。新增的自动发行版使用新版本号。

## 市场同步独立运行

`Prepare market update` 在发布工作流成功后启动，也支持手动输入已有公开标签：

```sh
gh workflow run market-sync.yml -f tag=v0.5.1
```

它使用默认分支上的受信任自动化代码，读取并核对真实公开 Release 与固定 Commit 的包清单，不执行下载产物中的代码。发版失败时不会开始投稿；市场失败也不会回滚或覆盖 GitHub Release。

### Awesome DSH Plugin

- 总会准备版本固定的 `awesome-entry.yml` 和 `awesome-pr.md`。
- 未配置专用凭据时，任务成功产出材料，并在 Summary 明确显示 `manual-required`；不是已经提交的 PR。
- 在 Actions Secret 配置 `MARKET_SYNC_TOKEN` 后可自动投稿。该凭据需要属于仓库 owner，并实际有权写入其目录 fork、向上游创建／更新 PR；GitHub 的具体 token 类型和资源限制以实际授权为准。
- 默认 `GITHUB_TOKEN` 不用于跨仓库投稿。不从开发机提取令牌，也不把令牌写入仓库、附件、日志或 Summary。
- 自动化先找自己已有的开放 PR；只有其修改范围全部为自己的条目时才更新，首次收录申请未合并也复用它。无匹配时创建一个版本分支与 PR。
- PR 内容相同则不再写入；不修改别人的条目、不重生成对方 README，不强推 fork 默认分支。匹配不唯一或范围异常时转人工核对。
- 收录是否通过、仓库年龄等条件仍由上游决定。

材料保存在本次运行的 `market-materials-*` Artifact，保留 30 天。向上游投稿失败时，仍可下载材料人工提交。

贡献规范：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>。

### DSH STORE

生成 `dsh-store-update.md`，优先等待其已有版本扫描与审核。当前没有接入正式版本更新 API，因此不自动重复建 Issue、刷评论或催审。已有投稿：<https://github.com/AI-Scarlett/DSH-Store/issues/1916>。

## 隐私与边界

- 发布任务运行在 GitHub 的干净检出目录，不连接开发者的 DSH Profile，也不读取真实任务、会话或备份。
- `npm run privacy` 检查暂存区；`node scripts/privacy.mjs --worktree` 检查重建后的文件；打包脚本再检查归档字节。
- Git 提交／标签／归档都不应包含个人截图、任务内容、凭据或本机路径。通用测试使用虚构数据。
- 发布说明应写清数据兼容与降级限制。自动发版不能替代界面实机验证，也不等于对用户设备执行升级。
- 不要为了运行自动化把个人主凭据复制进 CI；市场凭据缺失时，使用材料降级流程即可。

源码归档与 npm 包都遵循文件范围限制；隐私启发式检查无法识别所有个人信息，提交前仍应人工审阅。

## 本地诊断

```sh
npm run test:automation
node scripts/release.mjs check --tag v0.5.1
mkdir -p release
npm pack --pack-destination release
python scripts/package_release.py node
node scripts/release.mjs verify --tag v0.5.1
```

`check`／`verify` 需要检出对应已提交的标签。`publish` 是真实外部写入命令，仅在明确要发布且有正确权限时使用；正常由 Actions 调用。
