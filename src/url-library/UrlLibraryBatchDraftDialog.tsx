import { Trash2, X } from "lucide-react";

export interface UrlLibraryBatchDraft {
  name: string;
  url: string;
}

interface UrlLibraryBatchDraftDialogProps {
  drafts: UrlLibraryBatchDraft[];
  onChange: (drafts: UrlLibraryBatchDraft[]) => void;
  onSave: () => void;
  onClose: () => void;
  saving?: boolean;
}

export function UrlLibraryBatchDraftDialog({
  drafts,
  onChange,
  onSave,
  onClose,
  saving = false
}: UrlLibraryBatchDraftDialogProps) {
  const titleId = "url-library-batch-draft-title";

  function updateDraft(index: number, patch: Partial<UrlLibraryBatchDraft>) {
    onChange(drafts.map((draft, draftIndex) => (
      draftIndex === index ? { ...draft, ...patch } : draft
    )));
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) {
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
          if (!saving) {
            onSave();
          }
        }}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>存为全部网址草稿</h2>
            <p>确认保存前不会写入网址库。</p>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose} disabled={saving}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body url-library-edit-body">
          {drafts.map((draft, index) => (
            <section key={index} aria-label={`第 ${index + 1} 条网址`}>
              <label className="field" htmlFor={`url-library-batch-name-${index}`}>
                <span>网址名称</span>
                <input
                  id={`url-library-batch-name-${index}`}
                  aria-label={`第 ${index + 1} 条网址名称`}
                  value={draft.name}
                  onChange={(event) => updateDraft(index, { name: event.target.value })}
                  disabled={saving}
                />
              </label>
              <label className="field" htmlFor={`url-library-batch-url-${index}`}>
                <span>网址 URL</span>
                <input
                  id={`url-library-batch-url-${index}`}
                  aria-label={`第 ${index + 1} 条网址 URL`}
                  value={draft.url}
                  onChange={(event) => updateDraft(index, { url: event.target.value })}
                  disabled={saving}
                />
              </label>
              <button
                className="secondary-button compact danger"
                type="button"
                aria-label={`删除第 ${index + 1} 条网址`}
                onClick={() => onChange(drafts.filter((_, draftIndex) => draftIndex !== index))}
                disabled={saving}
              >
                <Trash2 size={14} />
                删除
              </button>
            </section>
          ))}
          {drafts.length === 0 ? <p className="muted-line">请至少保留一条网址。</p> : null}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>取消</button>
          <button className="primary-button" type="submit" disabled={saving || drafts.length === 0}>
            {saving ? "保存中..." : `保存 ${drafts.length} 个网址`}
          </button>
        </div>
      </form>
    </div>
  );
}
