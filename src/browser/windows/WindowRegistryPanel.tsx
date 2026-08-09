import type { BrowserWindowRegistryEntry } from "../../browserWindows";

interface WindowRegistryPanelProps {
  entries: BrowserWindowRegistryEntry[];
  checkedAt: string | null;
}

const statusLabels = {
  ready: "可读窗口",
  missing: "无可读窗口",
  error: "读取失败"
} as const;

function formatCheckedAt(checkedAt: string): string {
  const date = new Date(checkedAt);
  return Number.isNaN(date.getTime()) ? checkedAt : date.toLocaleString("zh-CN");
}

function formatBounds(entry: BrowserWindowRegistryEntry): string | null {
  const window = entry.primaryWindow;
  return window ? `${window.width}x${window.height} @ ${window.x},${window.y}` : null;
}

export function WindowRegistryPanel({
  entries,
  checkedAt
}: WindowRegistryPanelProps) {
  return (
    <section className="window-registry-panel" aria-label="窗口状态">
      <div className="window-registry-header">
        <strong>窗口状态</strong>
        {checkedAt ? <span>最近检查：{formatCheckedAt(checkedAt)}</span> : null}
      </div>
      {entries.length === 0 ? (
        <p className="muted-line">点击检查窗口读取选中运行账号的窗口状态</p>
      ) : (
        <ul className="window-registry-list" aria-label="窗口状态列表">
          {entries.map((entry) => {
            const bounds = formatBounds(entry);
            return (
              <li className="window-registry-row" key={entry.profileId}>
                <div className="window-registry-row-main">
                  <strong>{entry.profileName}</strong>
                  <span>{statusLabels[entry.status]}</span>
                </div>
                <div className="window-registry-row-detail">
                  <span>{entry.windowCount} 个窗口</span>
                  {bounds ? <span>{bounds}</span> : null}
                  {entry.minimized ? <span>已最小化</span> : null}
                  {entry.hasMultipleWindows ? <span>仅显示首个窗口</span> : null}
                  {entry.windowError ? <span>{entry.windowError}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
