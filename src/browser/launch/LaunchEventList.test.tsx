import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { BrowserLaunchEvent } from "../../browserSessionLaunch";
import { LaunchEventList } from "./LaunchEventList";

describe("LaunchEventList", () => {
  test("展示最近启动成功和失败记录", () => {
    const events: BrowserLaunchEvent[] = [
      {
        profileId: "account-001",
        profileName: "账号 1",
        url: "https://galxe.com",
        sourceLabel: "批量打开",
        ok: true,
        message: "已启动",
        finishedAt: 1
      },
      {
        profileId: "account-002",
        profileName: "账号 2",
        url: "chrome://newtab/",
        sourceLabel: "账号卡片",
        ok: false,
        message: "Chrome 未找到",
        finishedAt: 2
      }
    ];

    render(<LaunchEventList events={events} />);

    const launchList = screen.getByRole("list", { name: "最近启动记录" });
    expect(within(launchList).getByText("账号 1")).toBeTruthy();
    expect(within(launchList).getByText("账号 2")).toBeTruthy();
    expect(within(launchList).getByText("批量打开")).toBeTruthy();
    expect(within(launchList).getAllByText("目标")).toHaveLength(2);
    expect(within(launchList).getByText("失败原因")).toBeTruthy();
    expect(within(launchList).getByText("Chrome 未找到")).toBeTruthy();
  });
});
