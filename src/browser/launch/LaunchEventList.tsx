import type { BrowserLaunchEvent } from "../../browserSessionLaunch";
import { displayLaunchEventUrlLabel } from "../../shared/urlHelpers";

interface LaunchEventListProps {
  events: BrowserLaunchEvent[];
}

export function LaunchEventList({ events }: LaunchEventListProps) {
  return (
    <div className="launch-event-panel">
      <div className="launch-event-header">
        <strong>最近启动</strong>
        <span>{events.length > 0 ? `最近 ${events.length} 条` : "暂无记录"}</span>
      </div>
      {events.length === 0 ? (
        <p className="launch-event-empty">还没有启动记录</p>
      ) : (
        <ul className="launch-event-list" aria-label="最近启动记录">
          {events.map((event) => (
            <li
              className={`launch-event-row ${event.ok ? "success" : "failure"}`}
              key={`${event.profileId}-${event.finishedAt}-${event.sourceLabel}`}
            >
              <span className="launch-event-status">{event.ok ? "成功" : "失败"}</span>
              <span className="launch-event-field launch-event-name-field">
                <span className="launch-event-label">账号名</span>
                <span className="launch-event-name">{event.profileName}</span>
              </span>
              <span className="launch-event-field">
                <span className="launch-event-label">来源</span>
                <span className="launch-event-source">{event.sourceLabel}</span>
              </span>
              <span className="launch-event-field launch-event-url-field">
                <span className="launch-event-label">目标</span>
                <span className="launch-event-url">
                  {displayLaunchEventUrlLabel(event.url)}
                </span>
              </span>
              {!event.ok ? (
                <span className="launch-event-message">
                  <span className="launch-event-label">失败原因</span>
                  <span>{event.message}</span>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
