# MultiChrome 项目经理交接

更新时间：2026-08-11

## 新项目经理启动提示词

建议模型：`gpt-5.6-terra`，中型推理。用户口头说“5.6 terry”，如果界面显示为 Terry 就按用户命名选择；如果是 Codex 模型列表，实际应选 `gpt-5.6-terra` + `medium` reasoning。

可直接粘贴：

```text
你是 MultiChrome 项目的新项目经理，不是普通执行工。请始终用中文交流。

请先只读恢复上下文，不要改代码：
- AGENTS.md
- docs/project-manager-handoff.md
- docs/progress.md
- docs/browser-runtime-design.md

然后执行 /recap，确认当前状态。

工作方式：
- 项目经理主线程负责浏览、拆任务、派子 agent、裁决、验证、提交、PR、合并、checkpoint。
- 后续多数实现和审查任务优先交给子 agent；同一个任务尽量复用同一个子 agent，以树形结构往下发展。
- 子 agent 的模型由项目经理按成本选择：简单实现优先 Luna，中等实现/质量审查用 Terra，复杂架构/高风险审查再用更强模型。
- 珍惜额度，不要无意义开 agent，不要重复跑大测试；但提交和合并前必须有新鲜验证证据。
- 默认先优化、稳定、拆树干；进入新功能时只做小 PR。
- 不要先改代码；先读状态、确认范围、再派 agent。
- 不要恢复旧 stash。
- `docs/project-manager-handoff.md` 现在是交接文档，已允许维护；其它新文档不要主动创建，除非用户明确要求。

当前状态：
- main 已同步 origin/main。
- 当前最新 checkpoint：`efb284b Checkpoint runtime tab URL copy`。
- 最新功能 PR：#61 `Add runtime tab URL copy action`，已合并，merge commit `447d39b`。
- 工作区应只剩正常状态；如果看到旧的未跟踪/脏文件，先确认来源，不要随手删除或提交。

当前完成度：
- 优化/稳定线：100%。
- 新功能线：Browser Runtime 正式只读产品化已重新启动，已完成第一小刀。
- 目前明显体验：账号编辑弹窗可读取 Browser Runtime 标签页并复制 URL；批量关闭/重启运行账号已可用；左侧栏已固定；窗口动作有同步锁；备份/恢复/健康检查相关 stale 风险已基本收口。

下一步建议：
- 如果继续新功能：沿 Browser Runtime 只读路线小步推进，例如“复制全部标签页 URL”“从当前标签页生成网址库/项目草稿”“标签页面板轻量刷新”。继续不做 click/type、群控、自动任务或真实平台自动化。
- 如果继续优化：优先 BulkActionBar 契约清理，或只处理用户真实使用反馈的小修。
- 不建议直接做导航产品化、实时鼠标键盘同步、标签页同步、平台自动化、密码/钱包/签名相关能力。

执行规范：
- 每个 PR 一个小目标，先写清楚不做范围。
- 实现走 TDD：先失败测试，再最小生产代码，再验证。
- 至少两轮只读审查：规格审查 + 质量审查。
- 主线程必须亲自看 diff、跑验证、提交、push、建 PR、merge、更新 docs/progress.md checkpoint。
- 完成后 close 子 agent。
```

## 当前状态

- 仓库：`/Users/a0000/agent project/muti-chrome`
- 当前分支：`main`
- 当前 HEAD：`efb284b Checkpoint runtime tab URL copy`
- `main` 与 `origin/main`：已同步
- 最新合并 PR：[#61](https://github.com/1572817043/mutiChrome/pull/61) `Add runtime tab URL copy action`
- 最新功能 merge commit：`447d39b Add runtime tab URL copy action (#61)`
- 最新 checkpoint commit：`efb284b Checkpoint runtime tab URL copy`

## 用户长期要求

- 始终用中文交流。
- 项目经理模式：主线程负责拆任务、派子 agent、审查、验证、提交、PR、合并和 checkpoint。
- 后续首要使用子 agent 完成实现或审查任务；同一任务尽量复用同一个子 agent。
- 子 agent 模型由项目经理决定；用户关注额度，简单任务优先 Luna，中等任务用 Terra，复杂判断再上更强模型。
- 默认先优化、稳定、拆树干，再加新功能。
- 不要先改代码。
- 不要恢复旧 stash。
- 不要主动创建新文档，除非用户明确要求；本交接文档是用户明确要求更新。
- `docs/project-manager-handoff.md` 之前长期未跟踪；本次用户明确要求交接文档，因此可以维护它。

## 最近完成的主线

### V5.12 / PR #60

PR #60 `Guard stale restore failure messages` 已完成并合并，checkpoint 为 `bd12e72 Checkpoint restore failure stale guard`。

核心成果：

- 给轻量恢复和完整恢复的外层失败 message/loading 补 rootPath + data safety generation guard。
- root A 恢复 pending 后切到 root B，旧 reject 不再把旧错误写到当前 root。
- 不会重新打开确认态或留下旧恢复 loading。
- `finishRestoreOperation()` 保持无条件执行，避免 stale restore 卡住全局恢复互斥锁。
- `resetDataSafetyState()` 补清 `backupWorking`。

验证：

- `rtk npm test -- src/App.test.tsx -t "切换根目录后旧"`：2 passed
- `rtk npm run build`：通过
- `rtk npm test`：441 passed
- `rtk cargo test --manifest-path src-tauri/Cargo.toml`：91 passed
- `rtk git diff --check`：通过

### Browser Runtime PR #61

PR #61 `Add runtime tab URL copy action` 已完成并合并，checkpoint 为 `efb284b Checkpoint runtime tab URL copy`。

核心成果：

- 正式账号编辑弹窗里的“浏览器标签页”面板，现在每个已读取 tab 有行内复制 URL 图标按钮。
- `RuntimeTabsPanel` 只负责展示和回调。
- `App.tsx` 负责剪贴板能力检测、复制和全局 message。
- 保持既有复制文案风格。
- 测试覆盖：
  - 同名标签页用 URL 区分可访问名称。
  - 独立复制对应 URL。
  - 复制不影响读取。
  - 未传 handler 不显示复制按钮。
  - 剪贴板不支持/拒绝时的 App 提示。
  - `webSocketDebuggerUrl` 不展示、不复制。

明确不做：

- 不改 Rust/Tauri/API/持久化。
- 不新增导航。
- 不做 click/type、群控、自动任务、真实平台自动化。

验证：

- `rtk npm test`：447 passed
- `rtk npm run build`：通过
- `rtk cargo test --manifest-path src-tauri/Cargo.toml`：91 passed
- `rtk git diff --check`：通过
- 规格审查 PASS；质量审查首轮要求补可访问名称和剪贴板失败测试，已修复并复审 APPROVED。

## 当前产品体感

已经比较像一个可日常使用的多 Chrome profile 工作台：

- 多账号 Chrome profile 管理。
- 批量打开网址、项目入口、网址库、账号平台资料。
- 批量关闭运行账号、批量重启运行账号。
- 检查窗口、前置窗口、平铺窗口、同步布局。
- 左侧栏固定，更多操作展开不会把设置入口推到底部。
- 账号编辑弹窗可读取 Browser Runtime 标签页标题/URL，并复制 URL。
- 备份/恢复/健康检查/修复/孤儿登记相关 stale 风险已基本收口。

## 当前完成度

- 优化/稳定线：100%。
- Browser Runtime 正式只读产品化：已重新启动并完成第一小刀。
- App 树干仍大，但核心文档状态、mutation、restore、import、window controller 等风险边界已明显拆出。
- 后续进入新功能可以继续，但必须小 PR、清晰边界、避免功能膨胀。

## 下一步建议

如果继续新功能，推荐沿 Browser Runtime 只读路线：

1. 复制全部标签页 URL：基于已有 rows，不调用 CDP，不新增状态机。
2. 从当前已读取 tab 生成网址库草稿：必须保存前预览确认，不自动写入。
3. 从当前 tabs 生成项目草稿：只填草稿，不自动绑定账号或执行打开。
4. 标签页面板轻量刷新：只在用户点击时刷新，不做后台轮询。

如果继续优化：

1. BulkActionBar 契约清理：减少 App 组装压力，但要小心别大改 UI。
2. 继续拆 `App.tsx` 中仍然偏大的 UI 状态段。
3. 只处理真实使用反馈的小修。

暂不建议：

- 正式导航产品化。
- click/type。
- 鼠标、键盘、滚动、标签页同步。
- 群控。
- 自动任务库。
- 真实平台自动化。
- 密码、钱包、签名、私钥、助记词相关能力。

## 子 Agent 工作流建议

```text
Project Manager 主线程
├─ Route/Spec Agent：只读审计下一刀是否合理，可用 Luna
├─ Implementer Agent：TDD 实现当前小 PR，优先 Luna；中等复杂度 Terra
├─ Spec Review Agent：只读审查是否符合范围，Luna/Terra
├─ Quality Review Agent：只读审查风险、测试、可访问性、回归，Terra
└─ 主线程：裁决、验证、提交、push、PR、merge、checkpoint
```

规则：

- 子 agent 不提交、不 push、不建 PR、不合并。
- review agent 必须只读。
- 实现类任务尽量复用同一个 implementer agent 修复审查意见。
- 主线程必须亲自看 diff、跑验证、裁决 review。
- 完成后 close 子 agent，珍惜额度。

## 标准验证命令

优先用 `rtk`：

```bash
rtk npm test
rtk npm run build
rtk cargo test --manifest-path src-tauri/Cargo.toml
rtk git diff --check
```

如果只改前端小组件，可先跑定向测试；合并前仍建议跑全量前端测试、build、diff-check。改 Rust 或 Tauri command 时必须跑 Cargo 测试；窗口底层改动需要考虑 macOS 实机验证。

## PR 流程

1. 从 `main` 新建 `codex/...` 分支。
2. 明确本 PR 只做什么、不做什么。
3. 派 implementer agent 做 TDD。
4. 跑定向测试。
5. 派只读 spec review。
6. 修复必要问题。
7. 派只读 code quality review。
8. 修复必要问题并复审。
9. 全量验证。
10. 主线程提交代码。
11. push + 创建 PR。
12. 检查 PR merge state。
13. merge PR。
14. 同步 main。
15. 更新 `docs/progress.md` checkpoint，单独提交并 push。

## 重要提醒

- 不要恢复旧 stash。
- 不要把旧图标、旧状态报告或无关文档纳入主线。
- 不要因为“下一步是新功能”就打开大口子。
- Browser Runtime 当前正式产品化只读能力，不等于允许上群控或网页自动化。
- 涉及 root 切换、restore/import、document queue、持久化、Rust 文件操作时必须加竞态测试。
