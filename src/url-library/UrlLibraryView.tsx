import { Copy, Pencil, Play, Plus, Search, Trash2, X } from "lucide-react";
import type { UrlLibraryDraft } from "../domain/urlLibraryModel";
import { displayUrlLabel } from "../shared/urlHelpers";
import type { UrlLibraryItem } from "../types";

interface UrlLibraryViewProps {
  items: UrlLibraryItem[];
  visibleItems: UrlLibraryItem[];
  query: string;
  selectedCount: number;
  onQueryChange: (value: string) => void;
  onCreate: () => void;
  onEdit: (item: UrlLibraryItem) => void;
  onFillBulkUrl: (url: string) => void;
  onOpenWithSelected: (url: string) => void;
  onCopy: (url: string) => void;
  onDelete: (itemId: string) => void;
}

export function UrlLibraryView({
  items,
  visibleItems,
  query,
  selectedCount,
  onQueryChange,
  onCreate,
  onEdit,
  onFillBulkUrl,
  onOpenWithSelected,
  onCopy,
  onDelete
}: UrlLibraryViewProps) {
  const hasVisibleRows = visibleItems.length > 0;
  const normalizedQuery = query.trim();
  const showSearchEmpty = !hasVisibleRows && Boolean(normalizedQuery);
  const showLibraryEmpty = !hasVisibleRows && !normalizedQuery && items.length === 0;

  return (
    <>
      <section className="launcher-header url-library-header">
        <div className="url-library-title">
          <h1>网址库</h1>
          <span>{items.length} 个常用网址</span>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input
            aria-label="搜索网址"
            placeholder="搜索网址名称、标签、备注"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
      </section>

      <section className="url-library-table-panel" aria-label="常用网址列表">
        <div className="url-library-table-wrap">
          <table className="url-library-table" aria-label="网址库表格">
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col">网址</th>
                <th scope="col">标签</th>
                <th scope="col">描述</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <UrlLibraryTableRow
                  key={item.id}
                  item={item}
                  selectedCount={selectedCount}
                  onEdit={() => onEdit(item)}
                  onFillBulkUrl={() => onFillBulkUrl(item.url)}
                  onOpenWithSelected={() => onOpenWithSelected(item.url)}
                  onCopy={() => onCopy(item.url)}
                  onDelete={() => onDelete(item.id)}
                />
              ))}
              {showLibraryEmpty ? (
                <tr className="url-library-empty-row">
                  <td colSpan={5}>
                    <div className="url-library-empty-copy">
                      <h3>还没有常用网址</h3>
                      <p>把每天会重复打开的活动页、任务页或平台官网保存到这里。</p>
                    </div>
                  </td>
                </tr>
              ) : null}
              {showSearchEmpty ? (
                <tr className="url-library-empty-row">
                  <td colSpan={5}>
                    <div className="url-library-empty-copy">
                      <h3>没有匹配的网址</h3>
                      <p>
                        没有找到包含“{normalizedQuery}”的网址，换个名称、URL、标签或备注再试。
                      </p>
                    </div>
                  </td>
                </tr>
              ) : null}
              <tr className="url-library-new-item-row">
                <td colSpan={5}>
                  <button type="button" onClick={onCreate}>
                    <Plus size={14} />
                    新建
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

interface UrlLibraryTableRowProps {
  item: UrlLibraryItem;
  selectedCount: number;
  onEdit: () => void;
  onFillBulkUrl: () => void;
  onOpenWithSelected: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

export function UrlLibraryTableRow({
  item,
  selectedCount,
  onEdit,
  onFillBulkUrl,
  onOpenWithSelected,
  onCopy,
  onDelete
}: UrlLibraryTableRowProps) {
  const label = item.name || displayUrlLabel(item.url);
  const [category, ...secondaryTags] = item.tags;
  const openDisabled = selectedCount === 0;

  return (
    <tr>
      <td className="url-library-name-cell">
        <strong>{label}</strong>
      </td>
      <td className="url-library-url-cell">
        <code title={item.url}>{item.url}</code>
      </td>
      <td>
        <div className="url-library-table-tags">
          {category ? (
            <>
              <span className="url-library-select-pill">{category}</span>
              {secondaryTags.map((tag) => <span key={tag}>{tag}</span>)}
            </>
          ) : (
            <span className="muted-cell">空</span>
          )}
        </div>
      </td>
      <td className="url-library-notes-cell">
        {item.notes ? <p>{item.notes}</p> : <span className="muted-cell">无描述</span>}
      </td>
      <td className="url-library-actions-cell">
        <div className="url-library-row-actions">
          <button
            className="secondary-button compact"
            type="button"
            aria-label={`填入批量打开 ${label}`}
            onClick={onFillBulkUrl}
          >
            填入
          </button>
          <button
            className="primary-button compact"
            type="button"
            aria-label={`用选中账号打开 ${label}`}
            title={openDisabled ? "先在账号页选择账号" : undefined}
            disabled={openDisabled}
            onClick={onOpenWithSelected}
          >
            <Play size={14} />
            打开
          </button>
          {openDisabled ? <span className="url-library-action-note">先选择账号</span> : null}
          <button
            className="secondary-button compact icon-only"
            type="button"
            aria-label={`复制网址 ${label}`}
            onClick={onCopy}
          >
            <Copy size={14} />
          </button>
          <button
            className="secondary-button compact icon-only"
            type="button"
            aria-label={`编辑网址 ${label}`}
            onClick={onEdit}
          >
            <Pencil size={14} />
          </button>
          <button
            className="secondary-button compact icon-only danger"
            type="button"
            aria-label={`删除网址 ${label}`}
            onClick={onDelete}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

interface UrlLibraryEditDialogProps {
  title: string;
  draft: UrlLibraryDraft;
  onChange: (patch: Partial<UrlLibraryDraft>) => void;
  onSave: () => void;
  onClose: () => void;
}

export function UrlLibraryEditDialog({
  title,
  draft,
  onChange,
  onSave,
  onClose
}: UrlLibraryEditDialogProps) {
  const titleId = "url-library-edit-title";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        className="modal-card url-library-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p>保存后才会写入网址库。</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body url-library-edit-body">
          <label className="field" htmlFor="url-library-name">
            <span>网址名称</span>
            <input
              id="url-library-name"
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </label>
          <label className="field" htmlFor="url-library-url">
            <span>网址 URL</span>
            <input
              id="url-library-url"
              value={draft.url}
              onChange={(event) => onChange({ url: event.target.value })}
            />
          </label>
          <label className="field" htmlFor="url-library-tags">
            <span>网址标签</span>
            <input
              id="url-library-tags"
              placeholder="多个标签用逗号分隔"
              value={draft.tags}
              onChange={(event) => onChange({ tags: event.target.value })}
            />
          </label>
          <label className="field" htmlFor="url-library-notes">
            <span>网址备注</span>
            <textarea
              id="url-library-notes"
              value={draft.notes}
              onChange={(event) => onChange({ notes: event.target.value })}
            />
          </label>
        </div>
        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="submit">
            保存网址
          </button>
        </div>
      </form>
    </div>
  );
}

interface UrlLibraryDeleteConfirmDialogProps {
  item: UrlLibraryItem | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function UrlLibraryDeleteConfirmDialog({
  item,
  onCancel,
  onConfirm
}: UrlLibraryDeleteConfirmDialogProps) {
  if (!item) {
    return null;
  }

  const titleId = "url-library-delete-title";
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="modal-card delete-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>确认删除网址</h2>
            <p>{item.name || displayUrlLabel(item.url)}</p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭"
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </div>
        <p>这条常用网址会从网址库和批量打开常用项里移除。</p>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary-button danger" type="button" onClick={onConfirm}>
            确认删除
          </button>
        </div>
      </section>
    </div>
  );
}
