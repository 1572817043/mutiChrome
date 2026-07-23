import { X } from "lucide-react";
import { displayUrlLabel } from "../shared/urlHelpers";

interface UrlShortcutGroupProps {
  label: string;
  urls: string[];
  actionLabel: string;
  onPick: (url: string) => void;
  onRemove?: (url: string) => void;
}

export function UrlShortcutGroup({
  label,
  urls,
  actionLabel,
  onPick,
  onRemove
}: UrlShortcutGroupProps) {
  return (
    <div className="url-shortcut-group">
      <span>{label}</span>
      <div className="url-shortcut-list">
        {urls.map((url) => {
          const displayLabel = displayUrlLabel(url);
          return (
            <span className="url-shortcut-chip" key={url}>
              <button
                className="url-shortcut-button"
                type="button"
                aria-label={`${actionLabel} ${displayLabel}`}
                onClick={() => onPick(url)}
              >
                {displayLabel}
              </button>
              {onRemove ? (
                <button
                  className="url-shortcut-remove"
                  type="button"
                  aria-label={`删除常用网址 ${displayLabel}`}
                  onClick={() => onRemove(url)}
                >
                  <X size={12} />
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
