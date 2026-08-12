import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { UrlLibraryBatchDraftDialog } from "./UrlLibraryBatchDraftDialog";

describe("UrlLibraryBatchDraftDialog", () => {
  test("允许编辑删除和取消，且确认保存前明确不会写入", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function DialogHarness() {
      const [drafts, setDrafts] = useState([
        { name: "第一页", url: "https://example.com/first" },
        { name: "第二页", url: "https://example.com/second" }
      ]);
      return <UrlLibraryBatchDraftDialog drafts={drafts} onChange={setDrafts} onSave={vi.fn()} onClose={onClose} />;
    }
    render(
      <DialogHarness />
    );

    const dialog = screen.getByRole("dialog", { name: "存为全部网址草稿" });
    expect(within(dialog).getByText("确认保存前不会写入网址库。")).toBeTruthy();
    await user.clear(within(dialog).getByLabelText("第 1 条网址名称"));
    await user.type(within(dialog).getByLabelText("第 1 条网址名称"), "已编辑名称");
    expect((within(dialog).getByLabelText("第 1 条网址名称") as HTMLInputElement).value).toBe("已编辑名称");
    await user.click(within(dialog).getByRole("button", { name: "删除第 2 条网址" }));
    expect(within(dialog).queryByRole("button", { name: "删除第 2 条网址" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("删除全部条目后不能保存", async () => {
    const user = userEvent.setup();
    function DialogHarness() {
      const [drafts, setDrafts] = useState([{ name: "第一页", url: "https://example.com/first" }]);
      return (
        <UrlLibraryBatchDraftDialog
          drafts={drafts}
          onChange={setDrafts}
          onSave={vi.fn()}
          onClose={vi.fn()}
        />
      );
    }
    render(
      <DialogHarness />
    );

    await user.click(screen.getByRole("button", { name: "删除第 1 条网址" }));
    expect((screen.getByRole("button", { name: "保存 0 个网址" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("保存中锁定关闭和草稿编辑", () => {
    render(
      <UrlLibraryBatchDraftDialog
        drafts={[{ name: "第一页", url: "https://example.com/first" }]}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        saving
      />
    );

    expect((screen.getByRole("button", { name: "保存中..." }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "关闭" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("第 1 条网址名称") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("第 1 条网址 URL") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "删除第 1 条网址" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
