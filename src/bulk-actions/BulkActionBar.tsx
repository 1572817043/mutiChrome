import { ExternalLink, LayoutGrid, List } from "lucide-react";
import { useState } from "react";
import type { BrowserLaunchEvent } from "../browserSessionLaunch";
import type { BrowserOperation } from "../browserOperations";
import { LaunchEventList } from "../browser/launch/LaunchEventList";
import { OperationList } from "../browser/operations/OperationList";
import { UrlShortcutGroup } from "../url-library/UrlShortcutGroup";
import type { ChromeProfile } from "../types";

interface BulkActionBarProps {
  selectedCount: number;
  bulkTag: string;
  bulkUrl: string;
  bulkOpenIntervalSeconds: string;
  bulkOpenRunning: boolean;
  windowInspecting: boolean;
  windowTiling: boolean;
  windowSyncing: boolean;
  windowFocusing: boolean;
  selectedProfiles: ChromeProfile[];
  runningProfileIds: string[];
  layoutSourceProfileId: string;
  browserOperations: BrowserOperation[];
  launchEvents: BrowserLaunchEvent[];
  favoriteUrls: string[];
  recentUrls: string[];
  retryFailureCount: number;
  onBulkTagChange: (value: string) => void;
  onBulkUrlChange: (value: string) => void;
  onBulkOpenIntervalChange: (value: string) => void;
  onLayoutSourceProfileChange: (value: string) => void;
  onAppendTags: () => void;
  onAddFavoriteUrl: () => void;
  onRemoveFavoriteUrl: (url: string) => void;
  onOpenUrl: () => void;
  onRetryFailures: () => void;
  onInspectWindows: () => void;
  onTileWindows: () => void;
  onSyncLayout: () => void;
  onFocusWindows: () => void;
  onStopOpenQueue: () => void;
  onRequestDelete: () => void;
  onClear: () => void;
}

export function BulkActionBar({
  selectedCount,
  bulkTag,
  bulkUrl,
  bulkOpenIntervalSeconds,
  bulkOpenRunning,
  windowInspecting,
  windowTiling,
  windowSyncing,
  windowFocusing,
  selectedProfiles,
  runningProfileIds,
  layoutSourceProfileId,
  browserOperations,
  launchEvents,
  favoriteUrls,
  recentUrls,
  retryFailureCount,
  onBulkTagChange,
  onBulkUrlChange,
  onBulkOpenIntervalChange,
  onLayoutSourceProfileChange,
  onAppendTags,
  onAddFavoriteUrl,
  onRemoveFavoriteUrl,
  onOpenUrl,
  onRetryFailures,
  onInspectWindows,
  onTileWindows,
  onSyncLayout,
  onFocusWindows,
  onStopOpenQueue,
  onRequestDelete,
  onClear
}: BulkActionBarProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleRecentUrls = recentUrls.filter((url) => !favoriteUrls.includes(url));
  const hasBulkUrl = bulkUrl.trim().length > 0;
  const runningSelectedProfiles = selectedProfiles.filter((profile) =>
    runningProfileIds.includes(profile.id)
  );
  const windowActionDisabled =
    selectedCount === 0 ||
    bulkOpenRunning ||
    windowInspecting ||
    windowTiling ||
    windowSyncing ||
    windowFocusing;
  const selectedActionDisabled = selectedCount === 0 || bulkOpenRunning;
  const openButtonLabel = bulkOpenRunning
    ? "打开中"
    : hasBulkUrl
      ? "打开指定网址"
      : "打开新标签";
  const selectionHint = bulkOpenRunning
    ? "正在按队列打开账号，可随时停止后面的账号。"
    : selectedCount === 0
      ? "先勾选账号，再批量打开网址或新标签。"
      : hasBulkUrl
        ? `将为 ${selectedCount} 个账号打开指定网址。`
        : `将为 ${selectedCount} 个账号打开空白新标签。`;
  const openHint = selectedCount === 0
    ? "请选择至少 1 个账号。"
    : bulkOpenRunning
      ? "打开过程中输入和间隔会暂时锁定。"
      : hasBulkUrl
        ? "网址会自动补全 https://。"
        : "输入框为空时会打开 Chrome 新标签页。";

  return (
    <section className="bulk-action-bar" aria-label="批量操作">
      <div className="bulk-action-main">
        <div className="bulk-selection-status">
          <strong>{selectedCount > 0 ? `已选择 ${selectedCount} 个账号` : "未选择账号"}</strong>
          <small>{selectionHint}</small>
        </div>
        <div className="bulk-url-form">
          <input
            aria-label="批量打开网址"
            placeholder="输入网址；留空打开新标签"
            value={bulkUrl}
            disabled={bulkOpenRunning}
            onChange={(event) => onBulkUrlChange(event.target.value)}
          />
          <label className="bulk-interval-control">
            <span>间隔</span>
            <input
              aria-label="批量打开间隔秒"
              type="number"
              min="1"
              max="60"
              step="1"
              value={bulkOpenIntervalSeconds}
              disabled={bulkOpenRunning}
              onChange={(event) => onBulkOpenIntervalChange(event.target.value)}
            />
            <span>秒</span>
          </label>
          <button
            className="primary-button compact"
            type="button"
            disabled={bulkOpenRunning || selectedCount === 0}
            onClick={onOpenUrl}
          >
            {openButtonLabel}
          </button>
          {retryFailureCount > 0 ? (
            <button
              className="secondary-button compact"
              type="button"
              disabled={bulkOpenRunning}
              onClick={onRetryFailures}
            >
              重试最近失败 {retryFailureCount}
            </button>
          ) : null}
          {bulkOpenRunning ? (
            <button
              className="secondary-button compact danger"
              type="button"
              onClick={onStopOpenQueue}
            >
              停止
            </button>
          ) : null}
          <button
            className="secondary-button compact"
            type="button"
            aria-expanded={expanded}
            aria-controls="bulk-action-more"
            onClick={() => setExpanded((current) => !current)}
          >
            更多操作
          </button>
          <small className="bulk-open-hint">{openHint}</small>
          {retryFailureCount > 0 ? (
            <small className="bulk-open-hint">只重试最近一次批量打开失败的账号。</small>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="bulk-action-more" id="bulk-action-more">
          {favoriteUrls.length > 0 || visibleRecentUrls.length > 0 ? (
            <div className="url-shortcut-panel">
              <small className="bulk-panel-note">点击常用或最近网址只会填入上方输入框。</small>
              {favoriteUrls.length > 0 ? (
                <UrlShortcutGroup
                  label="常用"
                  urls={favoriteUrls}
                  actionLabel="使用常用网址"
                  onPick={onBulkUrlChange}
                  onRemove={onRemoveFavoriteUrl}
                />
              ) : null}
              {visibleRecentUrls.length > 0 ? (
                <UrlShortcutGroup
                  label="最近"
                  urls={visibleRecentUrls}
                  actionLabel="使用最近网址"
                  onPick={onBulkUrlChange}
                />
              ) : null}
            </div>
          ) : null}
          <div className="bulk-more-row">
            <button
              className="secondary-button compact"
              type="button"
              disabled={bulkOpenRunning}
              onClick={onAddFavoriteUrl}
            >
              设为常用
            </button>
            <div className="bulk-tag-form">
              <input
                aria-label="批量追加标签"
                placeholder="追加标签，逗号分隔"
                value={bulkTag}
                disabled={selectedCount === 0}
                onChange={(event) => onBulkTagChange(event.target.value)}
              />
              <button
                className="primary-button compact"
                type="button"
                disabled={selectedCount === 0}
                onClick={onAppendTags}
              >
                追加标签
              </button>
            </div>
          </div>
          <div className="bulk-more-row">
            <button
              className="secondary-button compact"
              type="button"
              disabled={windowActionDisabled}
              onClick={onInspectWindows}
            >
              <List size={15} />
              {windowInspecting ? "检查中" : "检查窗口"}
            </button>
            <button
              className="secondary-button compact"
              type="button"
              disabled={windowActionDisabled}
              onClick={onFocusWindows}
            >
              <ExternalLink size={15} />
              {windowFocusing ? "前置中" : "前置窗口"}
            </button>
            <button
              className="secondary-button compact"
              type="button"
              disabled={windowActionDisabled}
              onClick={onTileWindows}
            >
              <LayoutGrid size={15} />
              {windowTiling ? "平铺中" : "平铺窗口"}
            </button>
            <label className="bulk-source-control">
              <span>主账号</span>
              <select
                aria-label="布局同步主账号"
                value={layoutSourceProfileId}
                disabled={windowActionDisabled || runningSelectedProfiles.length === 0}
                onChange={(event) => onLayoutSourceProfileChange(event.target.value)}
              >
                {runningSelectedProfiles.length === 0 ? (
                  <option value="">无选中运行账号</option>
                ) : (
                  runningSelectedProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              className="secondary-button compact"
              type="button"
              disabled={windowActionDisabled}
              onClick={onSyncLayout}
            >
              {windowSyncing ? "同步中" : "同步布局"}
            </button>
          </div>
          <OperationList operations={browserOperations} />
          <LaunchEventList events={launchEvents.slice(0, 6)} />
          <div className="bulk-more-row">
            <button
              className="secondary-button compact"
              type="button"
              disabled={selectedCount === 0}
              onClick={onClear}
            >
              取消选择
            </button>
            <button
              className="secondary-button compact danger"
              type="button"
              disabled={selectedActionDisabled}
              onClick={onRequestDelete}
            >
              删除选中
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
