import { Copy, FolderOpen, Tags, Trash2, X } from "lucide-react";
import { formatBytes, profilePath } from "../api";
import type { AccountPlatform, ChromeProfile } from "../types";
import { AccountPlatformEditor } from "./AccountPlatformEditor";
import { AccentColorPicker } from "./AccentColorPicker";

interface EditProfileDialogProps {
  profile: ChromeProfile;
  rootPath: string;
  selectedSize: number | null;
  mode?: "edit" | "create";
  onChange: (patch: Partial<ChromeProfile>) => Promise<void>;
  onReveal?: () => Promise<void>;
  onDuplicate?: () => Promise<void>;
  onOpenAccountPlatform?: (accountPlatform: AccountPlatform) => void;
  onCopyAccountPlatformUsername?: (accountPlatform: AccountPlatform) => void;
  onDeleteRecord?: () => void;
  onDeleteWithData?: () => void;
  onSave?: () => Promise<void>;
  onClose: () => void;
}

export function EditProfileDialog({
  profile,
  rootPath,
  selectedSize,
  mode = "edit",
  onChange,
  onReveal,
  onDuplicate,
  onOpenAccountPlatform,
  onCopyAccountPlatformUsername,
  onDeleteRecord,
  onDeleteWithData,
  onSave,
  onClose
}: EditProfileDialogProps) {
  const titleId = "edit-profile-title";
  const creating = mode === "create";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="modal-card edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{creating ? "新建账号" : `编辑 ${profile.name}`}</h2>
            <p>{creating ? "保存后才会创建配置目录和账号记录" : profile.notes || profile.id}</p>
          </div>
          <div className="modal-header-actions">
            <button
              className="icon-button"
              type="button"
              aria-label={creating ? "取消新建账号" : "关闭编辑"}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="field">
            <label htmlFor="profile-name">名称</label>
            <input
              id="profile-name"
              value={profile.name}
              onChange={(event) => void onChange({ name: event.target.value })}
            />
          </div>

          <div className="field">
            <span className="field-label">颜色</span>
            <AccentColorPicker profile={profile} onChange={onChange} />
          </div>

          <div className="field">
            <label htmlFor="profile-tags">
              <Tags size={14} />
              标签
            </label>
            <input
              id="profile-tags"
              value={profile.tags.join(", ")}
              onChange={(event) =>
                void onChange({
                  tags: event.target.value.split(",").map((tag) => tag.trim())
                })
              }
            />
          </div>

          <div className="field">
            <label htmlFor="profile-notes">备注</label>
            <textarea
              id="profile-notes"
              rows={3}
              value={profile.notes}
              onChange={(event) => void onChange({ notes: event.target.value })}
            />
          </div>

          <AccountPlatformEditor
            accountPlatforms={profile.accountPlatforms}
            onChange={(accountPlatforms) => void onChange({ accountPlatforms })}
            onOpen={creating ? undefined : onOpenAccountPlatform}
            onCopyUsername={creating ? undefined : onCopyAccountPlatformUsername}
          />

          {!creating ? (
            <>
              <div className="field">
                <span className="field-label">配置文件夹</span>
                <div className="path-row">
                  <code>{profilePath(rootPath, profile.id)}</code>
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => void onReveal?.()}
                  >
                    <FolderOpen size={15} />
                    打开文件夹
                  </button>
                </div>
                <small className="muted-line">目录大小：{formatBytes(selectedSize)}</small>
              </div>

              <div className="action-grid">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void onDuplicate?.()}
                >
                  <Copy size={16} />
                  复制账号
                </button>
              </div>

              <div className="danger-zone">
                <div>
                  <strong>危险操作</strong>
                  <p>删除入口只放在这里，避免在账号卡片上误触。</p>
                </div>
                <div className="danger-actions">
                  <button
                    className="secondary-button danger"
                    type="button"
                    onClick={onDeleteRecord}
                  >
                    <Trash2 size={16} />
                    只删除记录
                  </button>
                  <button
                    className="primary-button danger"
                    type="button"
                    onClick={onDeleteWithData}
                  >
                    <Trash2 size={16} />
                    删除记录和文件夹
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void onSave?.()}
          >
            保存账号
          </button>
        </div>
      </section>
    </div>
  );
}
