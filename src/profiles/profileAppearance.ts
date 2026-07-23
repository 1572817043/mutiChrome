import { defaultAccentColor } from "../domain/profileModel";
import type { ChromeProfile, ProfileAccentColor } from "../types";

export const ACCENT_DETAILS: Record<ProfileAccentColor, { label: string; hex: string }> = {
  forest: { label: "松绿", hex: "#1f7048" },
  teal: { label: "青绿", hex: "#279a8d" },
  blue: { label: "深蓝", hex: "#2f7ec8" },
  sage: { label: "灰绿", hex: "#6b7c73" },
  violet: { label: "紫藤", hex: "#7f66ad" },
  clay: { label: "陶土", hex: "#a15f4a" },
  amber: { label: "琥珀", hex: "#b7791f" },
  rose: { label: "玫瑰", hex: "#b64f65" },
  cyan: { label: "青蓝", hex: "#16859b" },
  indigo: { label: "靛蓝", hex: "#4f67b0" },
  olive: { label: "橄榄", hex: "#6f7b2f" },
  slate: { label: "石板", hex: "#53616f" }
};

export function profileIndexLabel(profileId: string): string {
  const match = profileId.match(/(\d+)$/);
  if (!match) {
    return "01";
  }
  return match[1].slice(-2).padStart(2, "0");
}

export function resolveAccentColor(profile: ChromeProfile): ProfileAccentColor {
  if (profile.accentColor && profile.accentColor in ACCENT_DETAILS) {
    return profile.accentColor;
  }
  return defaultAccentColor(profile.id);
}

export function accentDetailsForProfile(profile: ChromeProfile) {
  return ACCENT_DETAILS[resolveAccentColor(profile)];
}
