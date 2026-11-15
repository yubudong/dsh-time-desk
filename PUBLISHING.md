# 发布准备与市场投稿

本项目的公开目标拟为 `https://github.com/yubudong/dsh-time-desk`。仓库地址、Issue 草稿和市场索引是准备材料；只有实际创建／推送／提交成功后，才可宣称已发布或上架。

## 当前名称检查

2026-11-15 检查公开 GitHub 搜索 `dsh-time-desk in:name` 和精确短语搜索，未发现匹配仓库；npm 公共注册表的 `dsh-time-desk` 返回 404。当前 GitHub 登录账号下的同名仓库也返回 404。

GitHub 名称按 owner 区分；上述结果不是商标检查，也不预留名称。公开前应重新核对目标账号、可见性和 npm 名称。

## 公开前的文件检查

1. 使用此独立目录，不要推送 DSH Profile 或整个个人工作区。
2. 运行 `npm run privacy`、`npm run check`、`npm run build`、`npm test`。
3. `git add` 后再次运行 `npm run privacy`。已有 Git 索引时，它检查实际暂存的 blob，防止工作区与暂存区不一致。
4. 检查 `git diff --cached --stat` 和具体修改。不得包含任务数据、聊天记录、JSON 备份、截图中的个人信息、密钥和本机路径。
5. `npm pack --pack-destination release`，然后 `python scripts/package_release.py node`，检查 ZIP、TGZ 和 SHA256SUMS。
6. 不提交 `node_modules`、`release`、私有数据或凭据。`dist` 需要提交，保证 Git 安装也有预构建文件。

Git 提交应使用 GitHub noreply 地址，不必公开个人邮箱。公开资源中保留的 `life_desk_v1`、`life_desk_spirit` 与 `dsh-life-desk` 旧格式标签是兼容代码，不是个人数据库。

## GitHub

- 先确认 owner 是 `yubudong`、仓库名是 `dsh-time-desk`、是否公开。
- 审核本地提交后再创建远端和 push，不要先上传真实数据再删除；Git 历史仍可能保留。
- 确认默认分支包含 `package.json`、`cordis.patch.yml`、`dist`、许可证和 README。
- 创建版本标签与 Release 后，上传审核过的 TGZ、source ZIP 与校验和。不要上传自己的 JSON 备份。
- 如果需要 npm，发布前重新检查名称与登录账号；使用包自身的无安装脚本分发内容。当前未承诺已经发布 npm。

## Awesome DSH Plugin

当前用户配置的索引之一：`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`。

参考：[贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。

- 仓库公开且安装可验证后，向目录仓库提交一个 YAML 文件。
- 本地已准备 `market/awesome/yubudong__dsh-time-desk.yml`，投稿路径是对方仓库的 `data/plugins/yubudong__dsh-time-desk.yml`。
- 不直接修改对方生成的 README；提交描述仅包含已实现功能和已说明限制。
- 该目录 README 当前说明：其原生 Discover format-1 索引覆盖已知 npm 版本。GitHub-only 收录与原生索引出现不是同一个状态；若选择仅 GitHub 发布，需向维护者核对当前支持的固定发行包方案。
- 生成 PR 不代表被维护者合并。

## DSH STORE

当前用户配置的另一索引：`https://dsh-store.cn/plugin-market.json`。

参考：[提交表单](https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml)。

- 仓库公开后，在上述表单提交 GitHub 项目地址；根目录插件无需填写子目录。
- 已准备 `market/dsh-store-submission.md`。先核对版本、权限和平台验证状态，再创建 Issue。
- 其当前流程会读取默认分支并固定 Commit 做静态预检，是否收录以该市场实际审核结果为准。

## 固定 Commit 的原生索引候选

完成本地提交后运行 `npm run market:index`，生成 `release/market-index.candidate.json`。它使用当前提交的完整 SHA、包版本和兼容范围，拒绝有未提交修改的源码。

该索引候选需要经当前安装版本的 `parseMarketIndex` 校验，并在 GitHub 真正公开该 Commit 后验证远端可访问性。它不是已经发布的市场源，也不会自动修改用户的索引配置。

## 维护

之后统一修改 `dsh-time-desk` 目录。旧 `dsh-life-desk` 开发目录只保留作本地历史参考，不混入新仓库。更换包注册不应删除独立工作台存储；升级前后检查 revision、计时器和记录 ID。
