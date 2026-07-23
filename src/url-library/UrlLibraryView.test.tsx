import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { UrlLibraryDraft } from "../domain/urlLibraryModel";
import type { UrlLibraryItem } from "../types";
import {
  UrlLibraryDeleteConfirmDialog,
  UrlLibraryEditDialog,
  UrlLibraryView
} from "./UrlLibraryView";
import { UrlShortcutGroup } from "./UrlShortcutGroup";

const libraryItem: UrlLibraryItem = {
  id: "url-001",
  name: "Galxe Daily",
  url: "https://galxe.com/daily",
  tags: ["daily", "airdrop"],
  notes: "每日签到",
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z"
};

describe("UrlLibraryView", () => {
  test("展示网址库表格并保留行级操作标签", () => {
    render(
      <UrlLibraryView
        items={[libraryItem]}
        visibleItems={[libraryItem]}
        query=""
        selectedCount={2}
        onQueryChange={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onFillBulkUrl={vi.fn()}
        onOpenWithSelected={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const table = screen.getByRole("table", { name: "网址库表格" });
    expect(within(table).getByText("Galxe Daily")).toBeTruthy();
    expect(screen.getByRole("button", { name: "填入批量打开 Galxe Daily" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "用选中账号打开 Galxe Daily" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制网址 Galxe Daily" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "编辑网址 Galxe Daily" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "删除网址 Galxe Daily" })).toBeTruthy();
  });

  test("空库和搜索无结果显示成熟的表格空状态", () => {
    const { rerender } = render(
      <UrlLibraryView
        items={[]}
        visibleItems={[]}
        query=""
        selectedCount={0}
        onQueryChange={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onFillBulkUrl={vi.fn()}
        onOpenWithSelected={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    const table = screen.getByRole("table", { name: "网址库表格" });
    expect(within(table).getByText("还没有常用网址")).toBeTruthy();
    expect(within(table).getByText("把每天会重复打开的活动页、任务页或平台官网保存到这里。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建" })).toBeTruthy();

    rerender(
      <UrlLibraryView
        items={[libraryItem]}
        visibleItems={[]}
        query="missing"
        selectedCount={1}
        onQueryChange={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onFillBulkUrl={vi.fn()}
        onOpenWithSelected={vi.fn()}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(within(table).getByText("没有匹配的网址")).toBeTruthy();
    expect(within(table).getByText("没有找到包含“missing”的网址，换个名称、URL、标签或备注再试。")).toBeTruthy();
  });

  test("未选择账号时网址库打开按钮说明禁用原因", () => {
    const onOpenWithSelected = vi.fn();

    render(
      <UrlLibraryView
        items={[libraryItem]}
        visibleItems={[libraryItem]}
        query=""
        selectedCount={0}
        onQueryChange={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onFillBulkUrl={vi.fn()}
        onOpenWithSelected={onOpenWithSelected}
        onCopy={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("先选择账号")).toBeTruthy();
    const openButton = screen.getByRole("button", { name: "用选中账号打开 Galxe Daily" });
    expect(openButton).toHaveProperty("disabled", true);
    fireEvent.click(openButton);
    expect(onOpenWithSelected).not.toHaveBeenCalled();
  });

  test("编辑弹窗保存草稿，删除弹窗保留确认文案", () => {
    const draft: UrlLibraryDraft = {
      name: "Galxe Daily",
      url: "https://galxe.com/daily",
      tags: "daily, airdrop",
      notes: "每日签到"
    };
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onConfirm = vi.fn();

    const { rerender } = render(
      <UrlLibraryEditDialog
        title="编辑网址"
        draft={draft}
        onChange={onChange}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("网址名称"), {
      target: { value: "Galxe" }
    });
    expect(onChange).toHaveBeenCalledWith({ name: "Galxe" });
    fireEvent.click(screen.getByRole("button", { name: "保存网址" }));
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender(
      <UrlLibraryDeleteConfirmDialog
        item={libraryItem}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("heading", { name: "确认删除网址" })).toBeTruthy();
    expect(screen.getByText("这条常用网址会从网址库和批量打开常用项里移除。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("UrlShortcutGroup", () => {
  test("展示网址快捷项并保留回填和删除标签", () => {
    const onPick = vi.fn();
    const onRemove = vi.fn();

    render(
      <UrlShortcutGroup
        label="常用"
        urls={["https://galxe.com/daily"]}
        actionLabel="回填常用网址"
        onPick={onPick}
        onRemove={onRemove}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "回填常用网址 galxe.com/daily" }));
    fireEvent.click(screen.getByRole("button", { name: "删除常用网址 galxe.com/daily" }));

    expect(onPick).toHaveBeenCalledWith("https://galxe.com/daily");
    expect(onRemove).toHaveBeenCalledWith("https://galxe.com/daily");
  });
});
