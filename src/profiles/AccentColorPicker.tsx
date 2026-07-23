import type { CSSProperties } from "react";
import { PROFILE_ACCENT_COLORS } from "../domain/profileModel";
import type { ChromeProfile } from "../types";
import { ACCENT_DETAILS, resolveAccentColor } from "./profileAppearance";

interface AccentColorPickerProps {
  profile: ChromeProfile;
  onChange: (patch: Partial<ChromeProfile>) => Promise<void>;
}

export function AccentColorPicker({ profile, onChange }: AccentColorPickerProps) {
  const currentColor = resolveAccentColor(profile);

  return (
    <div className="color-swatch-row">
      {PROFILE_ACCENT_COLORS.map((color) => {
        const accent = ACCENT_DETAILS[color];
        return (
          <button
            key={color}
            className={`color-swatch-button ${currentColor === color ? "active" : ""}`}
            type="button"
            aria-label={`选择颜色 ${accent.label}`}
            onClick={() => void onChange({ accentColor: color })}
          >
            <span
              className="color-swatch"
              style={{ "--profile-accent": accent.hex } as CSSProperties}
            />
            {accent.label}
          </button>
        );
      })}
    </div>
  );
}
