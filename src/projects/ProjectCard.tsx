import { Pencil, Play, X } from "lucide-react";
import { useState } from "react";
import type { AirdropProject, ChromeProfile } from "../types";
import { projectDisplayUrls } from "../domain/projectModel";
import { normalizeBulkOpenIntervalSeconds } from "../shared/formatHelpers";
import { displayUrlLabel } from "../shared/urlHelpers";

interface ProjectCardProps {
  project: AirdropProject;
  profiles: ChromeProfile[];
  opening: boolean;
  disabled: boolean;
  onOpen: (projectUrlId?: string) => void;
  onStop: () => void;
  onEdit: () => void;
}

export function ProjectCard({
  project,
  profiles,
  opening,
  disabled,
  onOpen,
  onStop,
  onEdit
}: ProjectCardProps) {
  const [openTarget, setOpenTarget] = useState("all");
  const projectUrls = projectDisplayUrls(project);
  const urlCountLabel = projectUrls.length === 0 ? "未设置网址" : `${projectUrls.length} 个网址`;
  const disabledReason = opening
    ? "正在按项目队列打开，停止后才能再次启动。"
    : disabled
      ? "另一个项目正在打开，当前项目暂时不可操作。"
      : projectUrls.length === 0
        ? "还没有设置网址，先编辑项目补上入口。"
        : profiles.length === 0
          ? "还没有绑定账号，先编辑项目选择要打开的账号。"
          : "";
  const openDisabled = Boolean(disabledReason);

  return (
    <article className="project-card">
      <div className="project-card-main">
        <strong>{project.name}</strong>
        <code>{urlCountLabel}</code>
      </div>
      <div className="project-meta-row">
        <span>{profiles.length} 个账号</span>
        <span>间隔 {normalizeBulkOpenIntervalSeconds(String(project.intervalSeconds))} 秒</span>
      </div>
      {disabledReason ? <p className="project-card-hint">{disabledReason}</p> : null}
      {projectUrls.length > 1 ? (
        <label className="project-url-select">
          <span>打开范围</span>
          <select
            aria-label={`${project.name} 打开网址`}
            value={openTarget}
            onChange={(event) => setOpenTarget(event.target.value)}
            disabled={opening || disabled}
          >
            <option value="all">全部网址</option>
            {projectUrls.map((projectUrl) => (
              <option key={projectUrl.id} value={projectUrl.id}>
                {projectUrl.name || displayUrlLabel(projectUrl.url)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="project-card-actions">
        <button
          className="primary-button compact"
          type="button"
          aria-label={`打开项目 ${project.name}`}
          disabled={openDisabled}
          title={disabledReason || undefined}
          onClick={() => onOpen(openTarget === "all" ? undefined : openTarget)}
        >
          <Play size={14} />
          {opening
            ? "打开中"
            : disabledReason
              ? "不可打开"
              : projectUrls.length > 1
                ? "打开"
                : "开始打开"}
        </button>
        {opening ? (
          <button
            className="secondary-button compact danger"
            type="button"
            aria-label={`停止项目 ${project.name}`}
            onClick={onStop}
          >
            <X size={14} />
            停止
          </button>
        ) : null}
        <button
          className="secondary-button compact"
          type="button"
          aria-label={`编辑项目 ${project.name}`}
          disabled={disabled}
          onClick={onEdit}
        >
          <Pencil size={14} />
          编辑
        </button>
      </div>
    </article>
  );
}
