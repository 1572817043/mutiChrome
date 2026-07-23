import { describe, expect, test } from "vitest";
import {
  errorMessage,
  windowAutomationErrorMessage
} from "./windowAutomationErrors";

describe("windowAutomationErrors", () => {
  test("formats unknown errors through String", () => {
    expect(errorMessage("plain")).toBe("plain");
  });

  test("adds osascript accessibility guidance for matching errors", () => {
    expect(
      windowAutomationErrorMessage(
        new Error("osascript: 不允许辅助访问 (-25211)")
      )
    ).toContain("同时允许 MultiChrome 和 /usr/bin/osascript");
  });

  test("adds general accessibility guidance for permission errors", () => {
    expect(windowAutomationErrorMessage(new Error("System Events not authorized"))).toContain(
      "允许 MultiChrome 控制电脑"
    );
  });
});
