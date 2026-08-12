import { Copy, Plus, RefreshCw } from "lucide-react";
import {
  isDraftableRuntimeTabUrl,
  type RuntimeTabsPanelModel,
  type RuntimeTabsPanelRow
} from "./runtimeTabs";

interface RuntimeTabsPanelProps {
  model: RuntimeTabsPanelModel;
  onReadTabs: () => void | Promise<void>;
  onCopyUrl?: (url: string) => void | Promise<void>;
  onCopyAllUrls?: (urls: string[]) => void | Promise<void>;
  onCopyAllTabDetails?: (
    tabs: Array<Pick<RuntimeTabsPanelRow, "title" | "url">>
  ) => void | Promise<void>;
  onSaveAsUrlDraft?: (
    tab: Pick<RuntimeTabsPanelRow, "title" | "rawTitle" | "url">
  ) => void;
  onSaveAllAsUrlDrafts?: (
    tabs: Array<Pick<RuntimeTabsPanelRow, "title" | "rawTitle" | "url">>
  ) => void;
  onSaveAsProjectDraft?: (
    tabs: Array<Pick<RuntimeTabsPanelRow, "title" | "rawTitle" | "url">>
  ) => void;
  loading?: boolean;
}

function shortTargetId(targetId: string): string {
  return targetId.length > 8 ? `${targetId.slice(0, 8)}…` : targetId;
}

function formatSnapshotTime(checkedAt: number): string {
  const date = new Date(checkedAt);
  return Number.isNaN(date.getTime()) ? String(checkedAt) : date.toLocaleString("zh-CN");
}

export function RuntimeTabsPanel({
  model,
  onReadTabs,
  onCopyUrl,
  onCopyAllUrls,
  onCopyAllTabDetails,
  onSaveAsUrlDraft,
  onSaveAllAsUrlDrafts,
  onSaveAsProjectDraft,
  loading = false
}: RuntimeTabsPanelProps) {
  const buttonDisabled = loading || !model.canReadTabs;
  const draftableRows = model.rows.filter((row) => isDraftableRuntimeTabUrl(row.url));

  return (
    <section className="runtime-tabs-panel" aria-labelledby="runtime-tabs-title">
      <div className="runtime-tabs-header">
        <div>
          <h3 id="runtime-tabs-title">浏览器标签页</h3>
          <div className="runtime-tabs-status">
            <span>CDP 状态：{model.cdpStatusLabel}</span>
            <span>调试端口：{model.debugPortLabel}</span>
            {model.rows.length > 0 ? (
              <span>当前快照：{formatSnapshotTime(model.rows[0].checkedAt)}（非实时）</span>
            ) : null}
          </div>
        </div>
        <button
          className="secondary-button compact"
          type="button"
          disabled={buttonDisabled}
          onClick={() => void onReadTabs()}
        >
          <RefreshCw size={14} />
          {loading ? "读取中" : "读取标签页"}
        </button>
        {model.rows.length > 0 && onCopyAllUrls ? (
          <button
            className="secondary-button compact"
            type="button"
            onClick={() => void onCopyAllUrls(model.rows.map((row) => row.url))}
          >
            <Copy size={14} />
            {`复制全部 ${model.rows.length} 个标签页网址`}
          </button>
        ) : null}
        {model.rows.length > 0 && onCopyAllTabDetails ? (
          <button
            className="secondary-button compact"
            type="button"
            onClick={() =>
              void onCopyAllTabDetails(
                model.rows.map((row) => ({ title: row.title, url: row.url }))
              )
            }
          >
            <Copy size={14} />
            {`复制全部 ${model.rows.length} 个标签页标题和网址`}
          </button>
        ) : null}
        {draftableRows.length > 0 && onSaveAllAsUrlDrafts ? (
          <button
            className="secondary-button compact"
            type="button"
            onClick={() =>
              onSaveAllAsUrlDrafts(
                draftableRows.map((row) => ({
                  title: row.title,
                  rawTitle: row.rawTitle,
                  url: row.url
                }))
              )
            }
          >
            <Plus size={14} />
            {`存为全部 ${draftableRows.length} 个网址草稿`}
          </button>
        ) : null}
        {draftableRows.length > 0 && onSaveAsProjectDraft ? (
          <button
            className="secondary-button compact"
            type="button"
            onClick={() =>
              onSaveAsProjectDraft(
                draftableRows.map((row) => ({
                  title: row.title,
                  rawTitle: row.rawTitle,
                  url: row.url
                }))
              )
            }
          >
            <Plus size={14} />
            存为项目草稿
          </button>
        ) : null}
      </div>

      {model.disabledReason && !loading ? (
        <p className="muted-line runtime-tabs-hint">{model.disabledReason}</p>
      ) : null}
      {model.errorMessage ? (
        <p className="runtime-tabs-error" role="alert">
          读取失败：{model.errorMessage}
        </p>
      ) : null}
      {model.emptyMessage ? <p className="muted-line">{model.emptyMessage}</p> : null}

      {model.rows.length > 0 ? (
        <ul className="runtime-tabs-list" aria-label="浏览器标签页列表">
          {model.rows.map((row) => (
            <li className="runtime-tabs-row" key={row.targetId}>
              <div className="runtime-tabs-row-main">
                <strong title={row.title}>{row.title}</strong>
                <span title={row.url}>{row.url}</span>
              </div>
              <div className="runtime-tabs-row-actions">
                <code title={row.targetId}>{shortTargetId(row.targetId)}</code>
                {onCopyUrl ? (
                  <button
                    className="icon-button compact"
                    type="button"
                    aria-label={`复制网址 ${row.title} ${row.url}`}
                    title="复制网址"
                    onClick={() => void onCopyUrl(row.url)}
                  >
                    <Copy size={14} />
                  </button>
                ) : null}
                {onSaveAsUrlDraft && isDraftableRuntimeTabUrl(row.url) ? (
                  <button
                    className="icon-button compact"
                    type="button"
                    aria-label={`存为网址草稿 ${row.title} ${row.url}`}
                    title="存为网址草稿"
                    onClick={() =>
                      onSaveAsUrlDraft({
                        title: row.title,
                        rawTitle: row.rawTitle,
                        url: row.url
                      })
                    }
                  >
                    <Plus size={14} />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
