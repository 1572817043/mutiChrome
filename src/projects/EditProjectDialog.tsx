import {
  ArrowDown,
  ArrowUp,
  Copy,
  Plus,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  createProjectUrl,
  normalizeEditableProjectUrls,
  parseProjectUrlImportLines,
  primaryProjectUrl,
  projectEditableUrls
} from "../domain/projectModel";
import { normalizeBulkOpenIntervalSeconds } from "../shared/formatHelpers";
import { normalizeLaunchUrl } from "../shared/urlHelpers";
import type { AirdropProject, ChromeProfile, ProjectUrl } from "../types";
import { ProjectDeleteConfirmPanel } from "./ProjectDeleteConfirmPanel";

interface EditProjectDialogProps {
  project: AirdropProject;
  profiles: ChromeProfile[];
  mode?: "edit" | "create";
  pendingDelete?: boolean;
  onChange: (patch: Partial<AirdropProject>) => Promise<void> | void;
  onSave?: (patch: Partial<AirdropProject>) => Promise<void> | void;
  onCopyUrl?: (projectUrl: ProjectUrl) => Promise<void> | void;
  onDuplicate?: () => void;
  onRequestDelete?: () => void;
  onCancelDelete?: () => void;
  onConfirmDelete?: () => Promise<void>;
  onClose: () => void;
}

export function EditProjectDialog({
  project,
  profiles,
  mode = "edit",
  pendingDelete = false,
  onChange,
  onSave,
  onCopyUrl,
  onDuplicate,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onClose
}: EditProjectDialogProps) {
  const titleId = "edit-project-title";
  const creating = mode === "create";
  const [intervalDraft, setIntervalDraft] = useState(String(project.intervalSeconds));
  const [urlImportOpen, setUrlImportOpen] = useState(false);
  const [urlImportDraft, setUrlImportDraft] = useState("");
  const projectUrls = projectEditableUrls(project);

  useEffect(() => {
    setIntervalDraft(String(project.intervalSeconds));
    setUrlImportOpen(false);
    setUrlImportDraft("");
  }, [project.id]);

  function toggleProfile(profileId: string, checked: boolean) {
    const nextIds = checked
      ? [...project.profileIds, profileId]
      : project.profileIds.filter((id) => id !== profileId);
    void onChange({ profileIds: [...new Set(nextIds)] });
  }

  function commitInterval() {
    const nextInterval = normalizeBulkOpenIntervalSeconds(intervalDraft);
    setIntervalDraft(String(nextInterval));
    void onChange({ intervalSeconds: nextInterval });
  }

  function changeProjectUrl(projectUrlId: string, patch: Partial<ProjectUrl>) {
    const nextUrls = projectUrls.map((projectUrl) =>
      projectUrl.id === projectUrlId ? { ...projectUrl, ...patch } : projectUrl
    );
    void onChange({
      urls: nextUrls,
      url: primaryProjectUrl(nextUrls)
    });
  }

  function normalizeProjectUrl(projectUrlId: string) {
    const nextUrls = projectUrls.map((projectUrl) =>
      projectUrl.id === projectUrlId
        ? { ...projectUrl, url: normalizeLaunchUrl(projectUrl.url) }
        : projectUrl
    );
    void onChange({
      urls: nextUrls,
      url: primaryProjectUrl(nextUrls)
    });
  }

  function addProjectUrl() {
    const nextUrls = [...projectUrls, createProjectUrl(projectUrls)];
    void onChange({
      urls: nextUrls,
      url: primaryProjectUrl(nextUrls)
    });
  }

  function moveProjectUrl(projectUrlId: string, offset: -1 | 1) {
    const currentIndex = projectUrls.findIndex((projectUrl) => projectUrl.id === projectUrlId);
    const nextIndex = currentIndex + offset;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= projectUrls.length) {
      return;
    }

    const nextUrls = [...projectUrls];
    const [movedUrl] = nextUrls.splice(currentIndex, 1);
    nextUrls.splice(nextIndex, 0, movedUrl);
    void onChange({
      urls: nextUrls,
      url: primaryProjectUrl(nextUrls)
    });
  }

  function applyProjectUrlImport() {
    const nextUrls = parseProjectUrlImportLines(urlImportDraft);
    if (nextUrls.length === 0) {
      return;
    }

    void onChange({
      urls: nextUrls,
      url: primaryProjectUrl(nextUrls)
    });
    setUrlImportDraft("");
    setUrlImportOpen(false);
  }

  function removeProjectUrl(projectUrlId: string) {
    const nextUrls = projectUrls.filter((projectUrl) => projectUrl.id !== projectUrlId);
    const safeNextUrls =
      nextUrls.length > 0 ? nextUrls : [createProjectUrl([], { id: "url-001", name: "主入口" })];
    void onChange({
      urls: safeNextUrls,
      url: primaryProjectUrl(safeNextUrls)
    });
  }

  function finalProjectPatch(): Partial<AirdropProject> {
    const nextUrls = normalizeEditableProjectUrls(projectUrls);
    const nextInterval = normalizeBulkOpenIntervalSeconds(intervalDraft);
    setIntervalDraft(String(nextInterval));
    return {
      url: primaryProjectUrl(nextUrls),
      urls: nextUrls,
      intervalSeconds: nextInterval
    };
  }

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
            <h2 id={titleId}>{creating ? "新建项目" : `编辑项目 ${project.name}`}</h2>
            <p>
              {creating
                ? "保存后才会创建项目记录"
                : primaryProjectUrl(projectUrls)
                  ? `${projectUrls.length} 个网址`
                  : project.id}
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={creating ? "取消新建项目" : "关闭项目编辑"}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label htmlFor="project-name">项目名称</label>
            <input
              id="project-name"
              aria-label="项目名称"
              value={project.name}
              onChange={(event) => void onChange({ name: event.target.value })}
            />
          </div>

          <div className="field">
            <div className="field-heading-row">
              <span className="field-label">项目网址</span>
              <div className="field-actions">
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => setUrlImportOpen((current) => !current)}
                >
                  <Upload size={14} />
                  批量导入网址
                </button>
                <button className="secondary-button compact" type="button" onClick={addProjectUrl}>
                  <Plus size={14} />
                  添加网址
                </button>
              </div>
            </div>
            {urlImportOpen ? (
              <div className="project-url-import">
                <label>
                  <span>批量网址</span>
                  <textarea
                    aria-label="批量网址文本"
                    rows={5}
                    value={urlImportDraft}
                    placeholder="Galxe https://galxe.com/quest 每日任务"
                    onChange={(event) => setUrlImportDraft(event.target.value)}
                  />
                </label>
                <div className="project-url-import-actions">
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => {
                      setUrlImportDraft("");
                      setUrlImportOpen(false);
                    }}
                  >
                    取消导入
                  </button>
                  <button
                    className="primary-button compact"
                    type="button"
                    onClick={applyProjectUrlImport}
                  >
                    应用导入网址
                  </button>
                </div>
              </div>
            ) : null}
            <div className="project-url-list">
              {projectUrls.map((projectUrl, index) => (
                <div className="project-url-item" key={projectUrl.id}>
                  <div className="project-url-item-header">
                    <strong>网址 {index + 1}</strong>
                    <div className="project-url-actions">
                      <button
                        className="icon-button compact"
                        type="button"
                        aria-label={`复制网址 ${projectUrl.name || index + 1}`}
                        onClick={() => void onCopyUrl?.(projectUrl)}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        className="icon-button compact"
                        type="button"
                        aria-label={`上移网址 ${projectUrl.name || index + 1}`}
                        disabled={index === 0}
                        onClick={() => moveProjectUrl(projectUrl.id, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="icon-button compact"
                        type="button"
                        aria-label={`下移网址 ${projectUrl.name || index + 1}`}
                        disabled={index === projectUrls.length - 1}
                        onClick={() => moveProjectUrl(projectUrl.id, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      {projectUrls.length > 1 ? (
                        <button
                          className="icon-button compact danger"
                          type="button"
                          aria-label={`删除网址 ${projectUrl.name || index + 1}`}
                          onClick={() => removeProjectUrl(projectUrl.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="project-url-fields">
                    <label>
                      <span>名称</span>
                      <input
                        aria-label={`网址名称 ${index + 1}`}
                        value={projectUrl.name}
                        onChange={(event) =>
                          changeProjectUrl(projectUrl.id, { name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>网址</span>
                      <input
                        aria-label={index === 0 ? "项目网址" : `项目网址 ${index + 1}`}
                        value={projectUrl.url}
                        onBlur={() => normalizeProjectUrl(projectUrl.id)}
                        onChange={(event) =>
                          changeProjectUrl(projectUrl.id, { url: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label className="project-url-note">
                    <span>网址备注</span>
                    <textarea
                      aria-label={`网址备注 ${index + 1}`}
                      rows={2}
                      value={projectUrl.notes}
                      onChange={(event) =>
                        changeProjectUrl(projectUrl.id, { notes: event.target.value })
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="project-interval">打开间隔</label>
            <input
              id="project-interval"
              aria-label="项目打开间隔秒"
              type="text"
              inputMode="numeric"
              min="1"
              max="60"
              step="1"
              value={intervalDraft}
              onBlur={commitInterval}
              onChange={(event) => {
                const nextValue = event.target.value;
                setIntervalDraft(nextValue);
                if (nextValue.trim()) {
                  void onChange({
                    intervalSeconds: normalizeBulkOpenIntervalSeconds(nextValue)
                  });
                }
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="project-notes">备注</label>
            <textarea
              id="project-notes"
              rows={3}
              value={project.notes}
              onChange={(event) => void onChange({ notes: event.target.value })}
            />
          </div>

          <div className="field">
            <span className="field-label">绑定账号</span>
            <div className="project-profile-picker">
              {profiles.map((profile) => {
                const selected = project.profileIds.includes(profile.id);
                return (
                  <button
                    key={profile.id}
                    className={`project-profile-option ${selected ? "selected" : ""}`}
                    type="button"
                    aria-label={`绑定账号 ${profile.name} ${profile.id}`}
                    aria-pressed={selected}
                    onClick={() => toggleProfile(profile.id, !selected)}
                  >
                    <span>{profile.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {!creating && onDuplicate ? (
            <div className="project-edit-actions">
              <span className="field-label">项目操作</span>
              <button className="secondary-button" type="button" onClick={onDuplicate}>
                <Copy size={16} />
                复制项目
              </button>
            </div>
          ) : null}

          {!creating ? (
            <div className="danger-zone">
              <div>
                <strong>危险操作</strong>
                <p>删除入口只放在这里，避免在项目卡片上误触。</p>
              </div>
              <div className="danger-actions">
                <button
                  className="primary-button danger"
                  type="button"
                  onClick={onRequestDelete}
                >
                  <Trash2 size={16} />
                  删除项目
                </button>
              </div>
            </div>
          ) : null}

          {!creating && pendingDelete && onCancelDelete && onConfirmDelete ? (
            <ProjectDeleteConfirmPanel
              project={project}
              onCancel={onCancelDelete}
              onConfirm={onConfirmDelete}
            />
          ) : null}
        </div>

        <div className="modal-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => void onSave?.(finalProjectPatch())}
          >
            保存项目
          </button>
        </div>
      </section>
    </div>
  );
}
