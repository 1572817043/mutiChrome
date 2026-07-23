import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { AirdropProject, ChromeProfile } from "../types";
import { EditProjectDialog } from "./EditProjectDialog";
import { ProjectCard } from "./ProjectCard";
import { ProjectDeleteConfirmPanel } from "./ProjectDeleteConfirmPanel";
import { ProjectsView } from "./ProjectsView";

function profile(overrides: Partial<ChromeProfile> = {}): ChromeProfile {
  return {
    id: "account-001",
    name: "主号",
    tags: ["galxe"],
    notes: "每日",
    status: "active",
    accountPlatforms: [],
    accentColor: "forest",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}

function project(overrides: Partial<AirdropProject> = {}): AirdropProject {
  return {
    id: "project-001",
    name: "Galxe 每日",
    url: "https://galxe.com/daily",
    urls: [
      {
        id: "url-001",
        name: "Galxe",
        url: "https://galxe.com/daily",
        notes: "每日任务"
      },
      {
        id: "url-002",
        name: "Zealy",
        url: "https://zealy.io/c/quest",
        notes: "抽奖"
      }
    ],
    notes: "重复入口",
    profileIds: ["account-001"],
    intervalSeconds: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}

describe("项目组件", () => {
  test("项目视图保留搜索、新建、打开、停止和编辑入口", () => {
    const onProjectQueryChange = vi.fn();
    const onCreateProject = vi.fn();
    const onOpenProject = vi.fn();
    const onStopProject = vi.fn();
    const onEditProject = vi.fn();
    const currentProject = project();

    render(
      <ProjectsView
        projects={[currentProject]}
        profiles={[profile()]}
        openingProjectId="project-001"
        projectQuery=""
        onProjectQueryChange={onProjectQueryChange}
        onCreateProject={onCreateProject}
        onOpenProject={onOpenProject}
        onStopProject={onStopProject}
        onEditProject={onEditProject}
      />
    );

    fireEvent.change(screen.getByLabelText("搜索项目"), {
      target: { value: "Galxe" }
    });
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    fireEvent.click(screen.getByRole("button", { name: "停止项目 Galxe 每日" }));

    expect(screen.getByText("Galxe 每日")).toBeTruthy();
    expect(screen.getByText("2 个网址")).toBeTruthy();
    expect(screen.getByText("1 个账号")).toBeTruthy();
    expect(onProjectQueryChange).toHaveBeenCalledWith("Galxe");
    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onStopProject).toHaveBeenCalledTimes(1);
  });

  test("项目卡片保留全部网址和单个网址打开语义", () => {
    const onOpen = vi.fn();

    render(
      <ProjectCard
        project={project()}
        profiles={[profile()]}
        opening={false}
        disabled={false}
        onOpen={onOpen}
        onStop={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));
    fireEvent.change(screen.getByLabelText("Galxe 每日 打开网址"), {
      target: { value: "url-002" }
    });
    fireEvent.click(screen.getByRole("button", { name: "打开项目 Galxe 每日" }));

    expect(onOpen).toHaveBeenNthCalledWith(1, undefined);
    expect(onOpen).toHaveBeenNthCalledWith(2, "url-002");
  });

  test("项目编辑弹窗保留多网址导入、排序、删除和保存式草稿", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onCopyUrl = vi.fn();
    const currentProject = project();

    render(
      <EditProjectDialog
        mode="edit"
        project={currentProject}
        profiles={[profile(), profile({ id: "account-002", name: "小号" })]}
        pendingDelete={true}
        onChange={onChange}
        onSave={onSave}
        onCopyUrl={onCopyUrl}
        onDuplicate={vi.fn()}
        onRequestDelete={vi.fn()}
        onCancelDelete={vi.fn()}
        onConfirmDelete={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "批量导入网址" }));
    fireEvent.change(screen.getByLabelText("批量网址文本"), {
      target: { value: "Quest https://example.com/quest 备注" }
    });
    fireEvent.click(screen.getByRole("button", { name: "应用导入网址" }));
    fireEvent.click(screen.getByRole("button", { name: "下移网址 Galxe" }));
    fireEvent.click(screen.getByRole("button", { name: "删除网址 Zealy" }));
    fireEvent.click(screen.getByRole("button", { name: "绑定账号 小号 account-002" }));
    fireEvent.click(screen.getByRole("button", { name: "复制网址 Galxe" }));
    fireEvent.change(screen.getByLabelText("项目打开间隔秒"), {
      target: { value: "99" }
    });
    fireEvent.blur(screen.getByLabelText("项目打开间隔秒"));
    fireEvent.click(screen.getByRole("button", { name: "保存项目" }));

    expect(onChange).toHaveBeenCalledWith({
      urls: [
        {
          id: "url-001",
          name: "Quest",
          url: "https://example.com/quest",
          notes: "备注"
        }
      ],
      url: "https://example.com/quest"
    });
    expect(onChange).toHaveBeenCalledWith({
      urls: [
        currentProject.urls[1],
        currentProject.urls[0]
      ],
      url: currentProject.urls[1].url
    });
    expect(onChange).toHaveBeenCalledWith({
      urls: [currentProject.urls[0]],
      url: currentProject.urls[0].url
    });
    expect(onChange).toHaveBeenCalledWith({
      profileIds: ["account-001", "account-002"]
    });
    expect(onChange).toHaveBeenCalledWith({ intervalSeconds: 60 });
    expect(onCopyUrl).toHaveBeenCalledWith(currentProject.urls[0]);
    expect(onSave).toHaveBeenCalledWith({
      url: currentProject.urls[0].url,
      urls: currentProject.urls,
      intervalSeconds: 60
    });
    expect(screen.getByText("确认删除项目")).toBeTruthy();
  });

  test("项目编辑弹窗提示空网址和未绑定账号但不禁用保存", () => {
    const onSave = vi.fn();

    render(
      <EditProjectDialog
        mode="create"
        project={project({
          url: "",
          urls: [
            {
              id: "url-001",
              name: "主入口",
              url: "",
              notes: ""
            }
          ],
          profileIds: []
        })}
        profiles={[profile()]}
        onChange={vi.fn()}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("至少保留一个非空网址，保存后项目卡片才能打开。")).toBeTruthy();
    expect(screen.getByText("还没有绑定账号，保存后项目暂时不能打开。")).toBeTruthy();
    const saveButton = screen.getByRole("button", { name: "保存项目" }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);

    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("项目删除确认面板保留删除文案和确认回调", () => {
    const onConfirm = vi.fn();

    render(
      <ProjectDeleteConfirmPanel
        project={project()}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByText("Galxe 每日 会从项目列表移除，不会删除任何 Chrome profile。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除项目" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("项目空状态和搜索无结果说明当前资料管理语义", () => {
    const { rerender } = render(
      <ProjectsView
        projects={[]}
        profiles={[]}
        openingProjectId={null}
        projectQuery=""
        onProjectQueryChange={vi.fn()}
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onStopProject={vi.fn()}
        onEditProject={vi.fn()}
      />
    );

    expect(screen.getByText("还没有项目")).toBeTruthy();
    expect(screen.getByText("项目用于保存多个入口网址、绑定账号和打开间隔，适合每天重复打开活动入口。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建第一个项目" })).toBeTruthy();

    rerender(
      <ProjectsView
        projects={[project()]}
        profiles={[]}
        openingProjectId={null}
        projectQuery="missing"
        onProjectQueryChange={vi.fn()}
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onStopProject={vi.fn()}
        onEditProject={vi.fn()}
      />
    );

    const list = screen.getByLabelText("项目列表");
    expect(within(list).getByText("没有匹配的项目")).toBeTruthy();
    expect(within(list).getByText("没有找到包含“missing”的项目，换个名称、网址或备注关键词再试。")).toBeTruthy();
  });

  test("项目卡片说明不能打开的原因且不改变编辑禁用规则", () => {
    const { rerender } = render(
      <ProjectCard
        project={project({ profileIds: [] })}
        profiles={[]}
        opening={false}
        disabled={false}
        onOpen={vi.fn()}
        onStop={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    expect(screen.getByText("还没有绑定账号，先编辑项目选择要打开的账号。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开项目 Galxe 每日" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "编辑项目 Galxe 每日" })).toHaveProperty("disabled", false);

    rerender(
      <ProjectCard
        project={project({ url: "", urls: [] })}
        profiles={[profile()]}
        opening={false}
        disabled={false}
        onOpen={vi.fn()}
        onStop={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    expect(screen.getByText("还没有设置网址，先编辑项目补上入口。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开项目 Galxe 每日" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "编辑项目 Galxe 每日" })).toHaveProperty("disabled", false);

    rerender(
      <ProjectCard
        project={project()}
        profiles={[profile()]}
        opening={false}
        disabled={true}
        onOpen={vi.fn()}
        onStop={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    expect(screen.getByText("另一个项目正在打开，当前项目暂时不可操作。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开项目 Galxe 每日" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "编辑项目 Galxe 每日" })).toHaveProperty("disabled", true);
  });
});
