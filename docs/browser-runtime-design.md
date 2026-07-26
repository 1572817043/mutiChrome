# Browser Runtime / CDP 控制层设计

## 背景与目标

MultiChrome 当前已经具备多 Chrome profile 管理、启动、运行状态识别、窗口检查、前置、平铺和布局同步能力。现有窗口能力主要依赖 Chrome 进程扫描和 macOS Accessibility，适合处理窗口资源，但不适合承载网页级动作。

Browser Runtime 的目标是把 CDP spike 中验证通过的网页控制能力转成主应用的运行时底座：在 profile 启动时分配本地 debug port，维护 profile runtime 状态，读取 tab 快照，并为后续离散网页动作、群控和自动化任务库提供清晰接口。

本阶段只做设计，不修改主应用代码。

## CDP Spike 结论引用

CDP spike 已在 PR #8 完成，实验目录为 `experiments/cdp-control/`。

实验结论：

- 多个独立 Chrome profile 可同时绑定不同 `remote debugging port`。
- 3 个独立 profile 同时运行并分别通过 CDP 读取 tab URL/title 验证通过。
- `navigate`、selector click、selector type 验证通过。
- selector 缺失时，失败会被限制在对应 profile，不阻塞其它 profile。
- 实验未新增第三方依赖，只使用 Node 内置 `fetch`、`WebSocket`、`node:test` 等能力。
- 实验未访问真实平台，未处理密码、钱包、签名、私钥、助记词。

对主应用的关键结论：

- 后续网页控制主路线应优先使用 CDP。
- macOS Accessibility 继续用于窗口排列和前置，不作为网页动作同步主干。
- 主应用必须在启动 profile 时分配并记录 `remote debugging port`。
- 已用普通方式启动且没有 debug port 的 profile，通常不能无损接入 CDP，需要提示用户重新打开。

## 产品边界

Browser Runtime 是网页控制底座，不是群控 UI。

本阶段不做真实平台自动化，不访问 X、Galxe、Zealy 或其它真实平台执行自动操作。

Browser Runtime 不处理以下敏感内容：

- 密码
- 钱包
- 签名
- 私钥
- 助记词

第一阶段只建议接入低风险运行时能力：启动带 debug port、runtime snapshot、list tabs。click/type 只保留为 spike 结论，不进入第一阶段产品化。

## 模块职责

Browser Runtime 负责：

- 为新启动 profile 分配本地 CDP debug port。
- 维护 profile 的 runtime 状态，包括运行状态、PID、debug port、CDP 可用性和错误。
- 通过 `http://127.0.0.1:<port>/json/version` 判断 CDP 是否可用。
- 通过 `http://127.0.0.1:<port>/json/list` 读取 tab snapshot。
- 建立和关闭 CDP WebSocket session。
- 执行离散网页动作，并返回结构化结果。
- 保证单个 profile 或 tab 失败不阻塞其它 profile。

Browser Runtime 不负责：

- profile 元数据编辑。
- 窗口坐标、窗口前置、窗口平铺、布局同步。
- 真实平台任务脚本。
- 钱包、密码、签名等敏感动作。

## 数据模型

### ProfileRuntime

表示一个 profile 当前的浏览器运行时状态。

```ts
type ProfileRuntime = {
  profileId: string;
  status: "starting" | "running" | "stopped";
  pid: number | null;
  debugPort: number | null;
  cdpStatus:
    | "unknown"
    | "available"
    | "missing-port"
    | "port-conflict"
    | "connecting"
    | "connected"
    | "failed";
  checkedAt: number;
  lastError: string | null;
};
```

说明：

- `status` 与现有 browser session 运行态保持一致。
- `debugPort` 只描述运行时绑定，不写入账号基础资料。
- `missing-port` 表示 profile 正在运行，但启动命令没有 CDP debug port。

### DebugPortAllocation

表示 debug port 的分配和绑定结果。

```ts
type DebugPortAllocation = {
  profileId: string;
  port: number;
  status: "reserved" | "bound" | "conflict" | "released";
  source: "previous" | "new";
  allocatedAt: number;
  boundPid: number | null;
};
```

说明：

- `reserved` 表示启动前预留。
- `bound` 表示 Chrome 已监听该 port。
- `conflict` 表示该 port 被其它进程占用。
- `released` 表示 runtime 生命周期结束后释放本地记录。

### TabSnapshot

表示从 CDP `/json/list` 读取到的 page target。

```ts
type TabSnapshot = {
  profileId: string;
  port: number;
  targetId: string;
  type: "page";
  url: string;
  title: string;
  webSocketDebuggerUrl: string | null;
  active?: boolean;
  checkedAt: number;
};
```

说明：

- 第一阶段只读取 `type: "page"` 的 target。
- `active` 第一阶段可选，不依赖它做产品逻辑。

### CdpSession

表示一个 CDP WebSocket 连接会话。

```ts
type CdpSession = {
  profileId: string;
  port: number;
  targetId: string;
  status: "connecting" | "open" | "closed" | "failed";
  openedAt: number;
  lastUsedAt: number;
  error: string | null;
};
```

说明：

- session 是短生命周期运行时对象，不写入 `profiles.json`。
- 第一阶段可以暂不长持有 session，list tabs 不需要 WebSocket。

### BrowserRuntimeActionResult

表示一次 Browser Runtime 动作的结构化结果。

```ts
type BrowserRuntimeActionResult<T = unknown> = {
  profileId: string;
  action: "snapshot-runtime" | "list-tabs" | "navigate" | "click-selector" | "type-text";
  status: "succeeded" | "failed" | "skipped";
  value?: T;
  error?: string;
  startedAt: number;
  finishedAt: number;
};
```

说明：

- 批量动作返回 `BrowserRuntimeActionResult[]`。
- 单 profile 失败只影响该 profile 的 result。
- 第一阶段只产品化 `snapshot-runtime` 和 `list-tabs`，可选验证 `navigate`。

## 启动策略

### 新启动 Profile 分配 Debug Port

新启动 profile 时，由后端在启动命令构造阶段分配 debug port。

推荐策略：

1. 为 Browser Runtime 定义固定端口池，例如 `9222` 起步的一段本地端口范围。
2. 启动前检测端口是否可监听。
3. 为 profile 生成 `DebugPortAllocation`。
4. Chrome 启动参数追加：
   - `--remote-debugging-port=<port>`
   - `--remote-debugging-address=127.0.0.1`
5. 启动后轮询 `http://127.0.0.1:<port>/json/version`。
6. 成功后 runtime 标记为 `cdpStatus: "available"`。

端口只监听 `127.0.0.1`，不开放到局域网。

### 已运行但无 Debug Port

已用普通方式运行且没有 `--remote-debugging-port` 的 profile，通常不能无损接入 CDP。

处理策略：

- session/runtime snapshot 标记为 `status: "running"`。
- `debugPort` 为 `null`。
- `cdpStatus` 为 `"missing-port"`。
- 不自动杀进程。
- 不自动重启 profile。
- UI 或操作层提示用户关闭后重新打开该 profile，以启用 Browser Runtime。

### Port 冲突处理

端口冲突不应阻塞整体批量启动。

处理策略：

- 分配前先检测候选 port。
- 如果 port 被占用，尝试判断是否属于同 profile 的已绑定 CDP。
- 如果不是同 profile，标记该 allocation 为 `conflict`，继续尝试下一个 port。
- 如果端口池耗尽，则该 profile 启动或 runtime 接入失败。
- 批量场景下，失败只记录到对应 profile 的 action result，不中断其它 profile。
- 不杀占用端口的未知进程。

## 与现有模块关系

### browserSessions

`browserSessions` 继续负责轻量浏览器会话快照，包括 `profileId`、`status`、`pid`、`windowCount`、`windows` 和 `windowError`。

Browser Runtime 可以在后续扩展 session snapshot，增加：

- `debugPort`
- `cdpStatus`
- `runtimeError`

但 `browserSessions` 不应持有 CDP WebSocket 连接，也不应执行网页动作。

### browserOperations

`browserOperations` 继续负责操作生命周期和最近操作记录。

后续 Browser Runtime 动作可以新增 operation type，例如：

```ts
type BrowserOperationType =
  | "profile-open"
  | "bulk-open-url"
  | "project-open"
  | "window-action"
  | "browser-runtime-action"
  | "ai-action";
```

第一阶段不要求接入完整 operation UI。若后续接入，应使用标准 summary 展示成功、失败、跳过数量。

### browserWindows

`browserWindows` 继续只处理窗口注册表、窗口 bounds、平铺和布局同步。

Browser Runtime 不进入 `browserWindows`。CDP 网页动作不依赖窗口 bounds，也不替代 macOS Accessibility 的窗口管理能力。

### profileApi / Tauri Commands

`profileApi` 是前端调用后端能力的边界。

第一阶段建议新增或扩展的 Tauri commands：

- 扩展 `open_profile`：启动时支持分配并注入 debug port。
- 新增 `snapshot_browser_runtimes`：返回 profile runtime 状态。
- 新增 `list_runtime_tabs`：读取指定 profile 的 tab snapshot。

后续再考虑：

- `navigate_runtime_tab`
- `run_runtime_action`
- `close_cdp_session`

## macOS / Windows 边界

### macOS

macOS 第一阶段继续复用现有 Chrome `.app` 启动路径和进程扫描逻辑。

窗口控制继续依赖 macOS Accessibility：

- 前置窗口
- 检查窗口
- 平铺窗口
- 同步布局

Browser Runtime 的 CDP 网页控制不依赖 Accessibility。

### Windows

Windows 后续应优先复用 Browser Runtime 的 CDP 网页控制模型。

需要单独适配：

- Chrome 可执行文件路径。
- 启动命令构造。
- 进程扫描和 `--user-data-dir` 解析。
- 窗口管理 API。

第一阶段不做 Windows 完整适配，但模型命名和接口不应绑定 macOS。

## 第一阶段最小接入范围

第一阶段建议只做：

- 启动 profile 时带 debug port。
- runtime snapshot。
- list tabs。

第一阶段明确不做：

- click/type 产品化。
- 群控 UI。
- 自动化任务库。
- 真实平台自动化。
- 钱包、密码、签名相关能力。

建议第一阶段验收标准：

- 新启动 profile 的命令行包含 `--remote-debugging-port` 和 `--remote-debugging-address=127.0.0.1`。
- runtime snapshot 能区分：
  - stopped
  - running with debug port
  - running without debug port
  - port conflict / CDP failed
- list tabs 能读取 URL/title。
- 多 profile list tabs 中，单 profile 失败不阻塞其它 profile。

## 测试策略

### 纯模型测试

- debug port 分配会跳过冲突端口。
- debug port 池耗尽时只失败当前 profile。
- runtime snapshot 能识别 `missing-port`。
- action result 能表达 succeeded、failed、skipped。
- 批量 result 不因单个 profile 失败中断。

### Rust 后端测试

- Chrome launch args 包含 CDP 参数。
- 已运行 profile 不被错误追加无效 debug port。
- 进程命令行可解析 `--remote-debugging-port`。
- port 检测不杀已有进程。
- runtime snapshot 能从进程参数提取 profileId、pid、debugPort。

### 集成验证

- 继续复用 `experiments/cdp-control/` 的本地测试页思路。
- 3 个 profile 同时启动并绑定不同 debug port。
- list tabs 能读取每个 profile 的 URL/title。
- 单 profile CDP 失败时，其它 profile 仍返回成功结果。

### 不需要的验证

第一阶段如果只改 CDP 启动参数、runtime snapshot 和 list tabs，不需要强制 macOS Accessibility 实机验证，因为没有修改窗口 API、bounds 写入、窗口读取或前置逻辑。

## 不做范围

本阶段不做：

- 群控 UI。
- 自动化任务库。
- 真实平台自动化。
- selector click/type 产品化。
- 钱包、密码、签名、私钥、助记词处理。
- 实时鼠标键盘同步。
- 坐标点击主路线。
- 代理、指纹、账号风控能力。
- 自动关闭或重启用户已运行的 Chrome。
- Windows 完整窗口管理。
- 修改图标。

## 后续路线

### 1. Runtime Snapshot

先把 Browser Runtime 接入主应用最小运行态：

- 启动带 debug port。
- snapshot 返回 debug port 和 CDP 状态。
- 已运行但缺少 debug port 时给出明确状态。

### 2. List Tabs / Navigate

在 runtime snapshot 稳定后，接入 tab 读取：

- list tabs 读取 URL/title。
- navigate 作为低风险网页动作验证。
- 仍只面向本地测试页或用户明确输入的普通 URL。

### 3. Group Control V0

在 runtime 和 tabs 稳定后，再评估 group control V0。

V0 应只做离散动作，不做实时键鼠同步：

- 多 profile 打开同一 URL。
- 多 profile 读取当前 tab。
- 单 profile 失败不影响其它 profile。

### 4. Automation Task Library

自动化任务库放在更后面。

进入任务库前必须先补齐：

- 明确的任务模型。
- 用户确认和预览机制。
- 失败隔离和重试策略。
- 安全边界检查。
- 真实平台禁用或白名单策略。

任务库不应反向污染 Browser Runtime。Browser Runtime 只提供底层能力，任务编排另建模块。
