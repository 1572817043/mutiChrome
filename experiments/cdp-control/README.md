# CDP Control Spike

MultiChrome CDP 可行性实验。目标是验证多个独立 Chrome profile 能否通过 Chrome DevTools Protocol 被同时连接和控制，为后续离散群控和自动化任务库判断技术路线。

## 约束

- 只使用实验目录下的临时 profile。
- 不访问真实平台。
- 不处理密码、钱包签名、私钥、助记词。
- 不做实时鼠标键盘同步。
- 不修改主应用 `src/` 或 `src-tauri/`。
- 不杀未由本实验脚本启动的 Chrome。

## 用法

```bash
cd experiments/cdp-control
npm test
node scripts/launch-profiles.mjs
node scripts/list-tabs.mjs
node scripts/run-actions.mjs
node scripts/cleanup-profiles.mjs
```

`launch-profiles.mjs` 会使用端口 `9222`、`9223`、`9224`。启动前会检测端口占用；如果任一端口已被占用，脚本会退出并提示，不会杀已有进程。

实验运行时文件保存在 `.runtime/`，临时 Chrome profile 保存在 `tmp-profiles/`。这些文件都被本目录 `.gitignore` 忽略。

## Node 版本前提

本实验依赖 Node 内置 `fetch`、`WebSocket` 和 `node:test`。已在当前 Codex/runtime Node 环境验证通过。如果其它环境没有 `globalThis.WebSocket`，应升级 Node；本 spike 不引入第三方 WebSocket 依赖。

## 实验结论

### 结果

通过。实验脚本成功启动 3 个独立临时 Chrome profile，并分别绑定 CDP 端口 `9222`、`9223`、`9224`。`list-tabs` 能读取每个 profile 的 tab、URL 和 title；`run-actions` 能让 `profile-a`、`profile-b` 通过 selector 完成点击和输入；`profile-c` 使用缺失按钮页面，按预期失败且没有阻塞其它 profile。

### macOS 结果

已在 macOS 本机验证。Chrome 可执行文件路径为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。启动参数使用独立 `--user-data-dir` 和独立 `--remote-debugging-port` 后，可以同时控制多个 profile。cleanup 通过 `.runtime/pids.json` 中的 pid 和命令行校验清理本实验启动的 Chrome，没有杀其它系统 Chrome。

### Windows 待测

待在 Windows 上验证 Chrome 可执行文件路径、进程启动方式、端口监听行为和 cleanup 命令行校验。

### 已知限制

- 已经用普通方式启动、没有 remote debugging port 的 Chrome profile，通常不能事后直接接入 CDP。
- 本实验只验证本地测试页，不代表真实平台页面稳定性。
- selector 自动化依赖页面 DOM 稳定性；真实平台需要单独 adapter 和失败降级策略。
- 坐标点击不作为主路线。

### 对主应用架构的结论

后续群控和自动化可以优先以 CDP 作为主路线，并把网页动作建模为离散语义动作，例如打开 URL、读取 URL/title、点击 selector、输入文本。macOS Accessibility 保留为窗口排列和前置能力，不作为网页动作同步主干。未来主应用要支持 CDP，需要在启动 profile 时分配 `remote debugging port` 并记录端口归属；已经普通方式启动且没有 `remote debugging port` 的 profile，通常不能无损接入 CDP，需要提示用户重启或重新打开 profile。
