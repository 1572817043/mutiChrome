import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ChromeProfile } from "../types";
import { BatchCreateProfilesDialog } from "./BatchCreateProfilesDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { EditProfileDialog } from "./EditProfileDialog";
import { ProfileEnvironmentPanel } from "./ProfileEnvironmentPanel";
import { ProfileCard } from "./ProfileCard";

function profile(overrides: Partial<ChromeProfile> = {}): ChromeProfile {
  return {
    id: "account-001",
    name: "主号",
    tags: ["galxe", "daily"],
    notes: "Google 已登录",
    status: "active",
    accountPlatforms: [],
    accentColor: "forest",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}

describe("账号展示组件", () => {
  test("账号卡片保留选择、打开、编辑和运行态入口", () => {
    const onToggleSelection = vi.fn();
    const onLaunch = vi.fn();
    const onFocusWindow = vi.fn();
    const onEdit = vi.fn();

    render(
      <ProfileCard
        profile={profile()}
        density="standard"
        selected={false}
        sessionStatus="running"
        onToggleSelection={onToggleSelection}
        onLaunch={onLaunch}
        onFocusWindow={onFocusWindow}
        onEdit={onEdit}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "选择 主号" }));
    fireEvent.click(screen.getByRole("button", { name: "打开 主号" }));
    fireEvent.click(screen.getByRole("button", { name: "切换到 主号" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 主号" }));

    expect(screen.getByText("运行中")).toBeTruthy();
    expect(onToggleSelection).toHaveBeenCalledWith(true);
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onFocusWindow).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test("账号编辑弹窗保留草稿回调、平台模板、复制用户名和遮罩关闭", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onClose = vi.fn();
    const onOpenAccountPlatform = vi.fn();
    const onCopyAccountPlatformUsername = vi.fn();
    const draft = profile({
      accountPlatforms: [
        {
          id: "platform-001",
          platform: "X",
          loginUrl: "https://x.com/i/flow/login",
          username: "main_user",
          notes: "已登录"
        }
      ]
    });

    render(
      <EditProfileDialog
        profile={draft}
        rootPath="/tmp/multichrome"
        selectedSize={2048}
        onChange={onChange}
        onSave={onSave}
        onOpenAccountPlatform={onOpenAccountPlatform}
        onCopyAccountPlatformUsername={onCopyAccountPlatformUsername}
        onClose={onClose}
      />
    );

    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "主号编辑" }
    });
    fireEvent.click(screen.getByRole("button", { name: "编辑账号平台 X" }));
    fireEvent.click(screen.getByRole("button", { name: "套用 Discord 模板" }));
    fireEvent.click(screen.getByRole("button", { name: "打开账号平台 X" }));
    fireEvent.click(screen.getByRole("button", { name: "复制用户名 X" }));
    fireEvent.click(screen.getByRole("button", { name: "保存账号" }));
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement, {
      target: screen.getByRole("dialog").parentElement
    });

    expect(onChange).toHaveBeenCalledWith({ name: "主号编辑" });
    expect(onChange).toHaveBeenCalledWith({
      accountPlatforms: [
        {
          id: "platform-001",
          platform: "Discord",
          loginUrl: "https://discord.com/login",
          username: "main_user",
          notes: "已登录"
        }
      ]
    });
    expect(onOpenAccountPlatform).toHaveBeenCalledWith(draft.accountPlatforms[0]);
    expect(onCopyAccountPlatformUsername).toHaveBeenCalledWith(draft.accountPlatforms[0]);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("编辑模式渲染标签页面板，而创建模式不渲染", () => {
    const panel = <div>运行时标签页面板</div>;
    const props = {
      profile: profile(),
      rootPath: "/tmp/multichrome",
      selectedSize: null,
      onChange: vi.fn(),
      onSave: vi.fn(),
      onClose: vi.fn(),
      runtimeTabsPanel: panel
    };

    const { rerender } = render(<EditProfileDialog {...props} />);
    expect(screen.getByText("运行时标签页面板")).toBeTruthy();

    rerender(<EditProfileDialog {...props} mode="create" />);
    expect(screen.queryByText("运行时标签页面板")).toBeNull();
  });

  test("环境隔离概览只呈现只读状态和手动刷新入口", () => {
    render(
      <ProfileEnvironmentPanel
        snapshot={{
          profileId: "account-001",
          profileDir: "/tmp/multichrome/profiles/account-001",
          directoryStatus: "ready",
          managedProfileRoot: true,
          registered: true,
          browserPath: "/Applications/Google Chrome.app",
          browserAvailable: true,
          running: true,
          healthIssues: []
        }}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "本地环境" })).toBeTruthy();
    expect(screen.getByText("受管 Profile 目录")).toBeTruthy();
    expect(screen.getByText("已登记")).toBeTruthy();
    expect(screen.getByRole("button", { name: "刷新本地环境" })).toBeTruthy();
    expect(screen.queryByText(/CDP|DevTools|端口/)).toBeNull();
  });

  test("环境隔离概览展示读取错误", () => {
    render(
      <ProfileEnvironmentPanel
        snapshot={null}
        loading={false}
        error="无法读取本地环境"
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByRole("alert").textContent).toContain("无法读取本地环境");
  });

  test("批量新建弹窗预览和删除确认文案保持不变", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onClose = vi.fn();
    const onConfirmDelete = vi.fn();

    render(
      <>
        <BatchCreateProfilesDialog
          value={"账号 A, galxe, 每日\n账号 B\tzealy\t抽奖"}
          onChange={onChange}
          onSave={onSave}
          onClose={onClose}
        />
        <DeleteConfirmDialog
          pendingDelete={{ profile: profile(), mode: "data" }}
          onCancel={onClose}
          onConfirm={onConfirmDelete}
        />
      </>
    );

    const preview = screen.getByLabelText("批量账号预览");
    expect(within(preview).getByText("账号 A")).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建 2 个账号" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "确认删除账号和文件夹" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onConfirmDelete).toHaveBeenCalledTimes(1);
  });

  test("批量新建弹窗说明粘贴格式并提示解析为空", () => {
    render(
      <BatchCreateProfilesDialog
        value=",,,"
        onChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("格式说明")).toBeTruthy();
    expect(screen.getByText("每行一个账号，第一列必须是账号名称。")).toBeTruthy();
    expect(screen.getByText("支持：名称, 标签, 备注；名称 | 标签 | 备注；表格 Tab 分隔内容。")).toBeTruthy();
    expect(screen.getByText("没有解析到可创建账号。请检查每行第一列是否有账号名称，并使用上面的格式粘贴。")).toBeTruthy();
    expect((screen.getByRole("button", { name: "创建 0 个账号" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
