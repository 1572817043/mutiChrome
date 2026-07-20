# MultiChrome MVP 开发规划

## 目标

构建一个 macOS 优先的多 Chrome 账号档案桌面管理器。第一版只解决一个问题：用一个软件管理多个独立 Chrome 配置文件夹，方便创建、备注、检测和一键打开不同账号环境。

## 第一版范围

- 技术栈：Tauri v2 + React + TypeScript + Vite。
- 开发平台：先支持 macOS。
- 数据根目录：用户设置一个本机目录，开发阶段默认可用 `~/MultiChromeProfiles`。
- 元数据：根目录下 `app-data/profiles.json`，跟随配置根目录迁移。
- 账号配置：根目录下 `profiles/<profile-id>/`，每个账号一个独立 Chrome `--user-data-dir`。
- 浏览器：调用系统已安装的 Google Chrome。
- UI：桌面管理工具风格，浅色、信息密度较高、可扩展 AppShell。

## 不做内容

- 不做群控。
- 不做代理。
- 不做浏览器指纹伪装。
- 不做自动任务。
- 不做钱包或社媒自动操作。
- 不做 Windows 适配，后续再加。

## 数据目录结构

```text
MultiChromeProfiles/
  app-data/
    profiles.json
  profiles/
    account-001/
    account-002/
```

## 账号元数据

每个账号档案包含：

- `id`：稳定 ID，例如 `account-001`
- `name`：显示名称
- `tags`：标签
- `notes`：备注
- `status`：`active`、`needs_check`、`archived`
- `createdAt`：创建时间
- `updatedAt`：更新时间
- `lastOpenedAt`：最后打开时间，可为空

## UI 结构

```text
AppShell
  TopBar：根目录状态、Chrome 状态、账号数量、总占用
  Sidebar：模块导航，MVP 只显示“账号”
  MainArea：账号列表、搜索、筛选、创建
  Inspector：账号详情、备注、标签、路径、操作按钮
```

第一版主按钮是“打开 Chrome”。布局保留后续扩展到项目、任务、代理、设置的空间。

## 实现阶段

1. 初始化 Tauri + React + TypeScript 项目骨架。
2. 实现账号数据模型和 JSON 结构校验。
3. 实现浏览器预览模式的本地假数据存储，方便前端调试。
4. 实现 Tauri 后端命令：初始化根目录、读写 `profiles.json`、计算目录大小、检测 Chrome、打开 profile。
5. 实现 AppShell、账号列表、详情面板和基础表单。
6. 联调桌面能力。
7. 验证构建、测试和基础操作流程。

## 验收标准

- 首次打开能看到根目录设置入口。
- 使用默认本机目录后，软件能创建 `app-data` 和 `profiles`。
- 能创建账号档案，并写入 `profiles.json`。
- 每个账号有独立 profile 目录。
- 点击账号的“打开 Chrome”能用对应 `--user-data-dir` 启动 Chrome。
- 能编辑账号名称、标签、备注和状态。
- 能显示 Chrome 是否检测到、根目录是否可写、账号数量。
- 浏览器预览构建可用，Tauri 桌面运行可用。
