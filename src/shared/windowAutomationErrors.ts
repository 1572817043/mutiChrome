export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function windowAutomationErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (isLikelyOsascriptAccessibilityError(message)) {
    return `窗口操作失败：macOS 当前拦截的是 /usr/bin/osascript。请在系统设置 > 隐私与安全性 > 辅助功能 中同时允许 MultiChrome 和 /usr/bin/osascript。原始错误：${message}`;
  }
  if (isLikelyWindowAutomationPermissionError(message)) {
    return `窗口操作失败：可能需要在 macOS 系统设置 > 隐私与安全性 > 辅助功能 中允许 MultiChrome 控制电脑。原始错误：${message}`;
  }

  return `窗口操作失败：${message}`;
}

function isLikelyOsascriptAccessibilityError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("osascript") &&
    (message.includes("不允许辅助访问") ||
      normalized.includes("-25211") ||
      normalized.includes("not allowed assistive"))
  );
}

function isLikelyWindowAutomationPermissionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return [
    "system events",
    "osascript",
    "not authorized",
    "not permitted",
    "operation not permitted",
    "permission",
    "辅助功能",
    "权限",
    "apple events"
  ].some((keyword) => normalized.includes(keyword));
}
