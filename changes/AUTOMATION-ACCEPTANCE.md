# 第一期自动发布验收记录

日期：2026-11-15。自动化实现已部署到 main；本记录只描述真实执行结果，不代表用户侧自动安装功能。

## 已通过

| 场景 | 结果 | 证据 |
|---|---|---|
| 完整测试版发版 | `v0.5.1-beta.2` 完成版本检查、六组跨平台／Node 检查、归档、草稿上传、摘要核对和公开 | [发布运行](https://github.com/yubudong/dsh-time-desk/actions/runs/43709995000) |
| 版本不一致 | 故意推送与包版本不一致的验收标签；在 preflight 被阻止，未创建草稿或公开 Release | [预期失败运行](https://github.com/yubudong/dsh-time-desk/actions/runs/43709284715) |
| 公开版本重跑 | 从手动入口重跑同一测试标签；返回 `already-published`，Release ID、发布时间、三个附件 ID／大小／SHA-256 全部保持一致 | [重跑运行](https://github.com/yubudong/dsh-time-desk/actions/runs/43710328247) |
| 稳定通道保护 | 发布与重跑之后，Latest 仍为 `v0.5.0`；测试版标为 Pre-release | [测试版](https://github.com/yubudong/dsh-time-desk/releases/tag/v0.5.1-beta.2) |
| 缺少市场授权 | 对既有稳定版本生成 YAML、PR 说明和 DSH STORE 更新材料，成功返回 `manual-required`；没有重复投稿 | [市场材料运行](https://github.com/yubudong/dsh-time-desk/actions/runs/43709479127) |
| 测试版市场隔离 | 自动链式市场流程返回 `skipped-prerelease`，没有推广到稳定市场入口 | [自动市场运行](https://github.com/yubudong/dsh-time-desk/actions/runs/43710110223) |
| 本地测试 | 最终本地 109 项自动测试通过；测试标签快照中的 108 项已执行跨平台检查。覆盖部分上传恢复、不可覆盖、冲突摘要、草稿查询、重复 PR 防护和归档隐私字节检查 | 测试源码与上述跨平台运行 |
| 归档确定性 | 同一源提交重复构建源码 ZIP 与校验和，摘要保持一致；真实公开重跑也核对通过 | 本地归档检查与重跑运行 |

## 实跑中发现并修复的问题

首次 `beta.1` 验收在最终草稿状态核对处停止：GitHub 的按标签查询接口不返回草稿，即使附件已经完整上传。流程没有提前公开不完整版本。

修复后，认证后的列表用于查找草稿，公开前按 Release ID 复核标签、来源、通道和状态。对应回归测试已加入；随后 `beta.2` 完整发版与重跑均成功。首轮失败的测试草稿在核对 ID、标签、来源 Commit 和 draft 状态后清理，没有删除既有公开版本。

最终审查还补充了公开 Release 的来源 Commit 绑定：即使归档碰巧相同，改指标签也不能被当作合法的原版本重跑。该边界有回归测试，并使用真实 `beta.2` Release 在禁止写入的适配器下核对通过。

## 当前授权与范围

- `MARKET_SYNC_TOKEN` 尚未配置，因而没有把自动创建／更新上游 PR 描述为已在真实授权下执行。该路径有状态与范围回归测试；当前真实验收使用方案允许的材料降级。
- DSH STORE 只生成更新材料，继续依赖其既有扫描和审核；本流程不刷 Issue 或重复评论。
- 测试版通过独立 Git worktree 准备，没有安装到开发者正在使用的 DSH Profile。主工作区的运行 bundles 与原稳定版保持一致。
- 未读取或上传个人任务、会话、备份或模型凭据；自动发布环境不连接开发者 DSH 存储。
- 用户侧新版本提示、一键升级、后台自动安装仍属于第二期，本次未实现。

## 后续使用

维护者按 [PUBLISHING.md](../PUBLISHING.md) 更新版本、填写版本说明并提交预构建文件，推送 `v版本号` 标签即可触发。失败草稿可以重试，已公开版本不得自动覆盖。市场材料保留在相应 Actions Artifact 中。
