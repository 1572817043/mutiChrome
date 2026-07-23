import { ExternalLink, Pencil, Play } from "lucide-react";
import type { CSSProperties } from "react";
import type { BrowserSessionStatus } from "../api";
import type { ChromeProfile } from "../types";
import { accentDetailsForProfile, profileIndexLabel } from "./profileAppearance";

export type CardDensity = "standard" | "compact";

interface ProfileCardProps {
  profile: ChromeProfile;
  density: CardDensity;
  selected: boolean;
  sessionStatus: BrowserSessionStatus;
  onLaunch: () => void;
  onFocusWindow: () => void;
  onEdit: () => void;
  onToggleSelection: (selected: boolean) => void;
}

export function ProfileCard({
  profile,
  density,
  selected,
  sessionStatus,
  onLaunch,
  onFocusWindow,
  onEdit,
  onToggleSelection
}: ProfileCardProps) {
  const accent = accentDetailsForProfile(profile);
  const cardStyle = { "--profile-accent": accent.hex } as CSSProperties;
  const running = sessionStatus === "running";
  const starting = sessionStatus === "starting";

  return (
    <article
      className={`profile-card-shell ${selected ? "selected" : ""}`}
      style={cardStyle}
    >
      <button
        className={`profile-card ${density}`}
        type="button"
        aria-label={`选择 ${profile.name}`}
        aria-pressed={selected}
        onClick={() => onToggleSelection(!selected)}
      >
        <span className="profile-avatar" aria-label={`颜色 ${accent.label}`}>
          {profileIndexLabel(profile.id)}
        </span>
        <span className="profile-card-main">
          <strong>{profile.name}</strong>
          <small>{profile.notes || profile.id}</small>
          <span className="tag-list">
            {profile.tags.length > 0 ? (
              profile.tags.slice(0, 2).map((tag) => (
                <span key={tag}>{tag}</span>
              ))
            ) : (
              <small>未设置标签</small>
            )}
          </span>
        </span>
        {running || starting ? (
          <span className="profile-card-side">
            <span className="profile-running-badge">
              {starting ? "启动中" : "运行中"}
            </span>
          </span>
        ) : null}
      </button>
      <div className="profile-card-actions">
        {running ? (
          <button
            className="profile-focus-button"
            type="button"
            aria-label={`切换到 ${profile.name}`}
            onClick={onFocusWindow}
          >
            <ExternalLink size={14} />
          </button>
        ) : null}
        <button
          className="profile-open-button"
          type="button"
          aria-label={`打开 ${profile.name}`}
          onClick={onLaunch}
        >
          <Play size={14} />
        </button>
        <button
          className="profile-edit-button"
          type="button"
          aria-label={`编辑 ${profile.name}`}
          onClick={onEdit}
        >
          <Pencil size={15} />
        </button>
      </div>
    </article>
  );
}
