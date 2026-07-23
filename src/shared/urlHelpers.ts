export const DEFAULT_PROFILE_LAUNCH_URL = "chrome://newtab/";

export function normalizeLaunchUrl(value: string): string {
  const cleaned = value.trim();
  if (!cleaned) {
    return "";
  }
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  return `https://${cleaned}`;
}

export function displayUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
    return `${parsed.host}${path}`;
  } catch {
    return url.replace(/^https?:\/\//i, "");
  }
}

export function displayLaunchEventUrlLabel(url: string): string {
  if (url === DEFAULT_PROFILE_LAUNCH_URL) {
    return "新标签页";
  }

  return displayUrlLabel(url);
}
