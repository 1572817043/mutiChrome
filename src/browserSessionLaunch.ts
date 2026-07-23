export type BrowserLaunchResult =
  | {
      ok: true;
      profileId: string;
      profilePath: string;
      finishedAt: number;
    }
  | {
      ok: false;
      profileId: string;
      message: string;
      finishedAt: number;
    };

export interface BrowserLaunchFailureDetail {
  profileId: string;
  profileName: string;
  message: string;
}

export interface BrowserLaunchSummary {
  totalCount: number;
  successCount: number;
  failureCount: number;
  failures: BrowserLaunchFailureDetail[];
}

export interface BrowserLaunchQueueSummary extends BrowserLaunchSummary {
  queuedCount: number;
  stopped: boolean;
}

export interface BrowserLaunchEvent {
  profileId: string;
  profileName: string;
  sourceLabel: string;
  url: string;
  ok: boolean;
  message: string;
  finishedAt: number;
}

export const MAX_BROWSER_LAUNCH_EVENTS = 30;

export function browserLaunchSucceeded(
  profileId: string,
  profilePath: string,
  finishedAt = Date.now()
): BrowserLaunchResult {
  return {
    ok: true,
    profileId,
    profilePath,
    finishedAt
  };
}

export function browserLaunchFailed(
  profileId: string,
  error: unknown,
  finishedAt = Date.now()
): BrowserLaunchResult {
  return {
    ok: false,
    profileId,
    message: error instanceof Error ? error.message : String(error),
    finishedAt
  };
}

export function shouldMarkStartingAfterLaunch(
  result: BrowserLaunchResult
): boolean {
  return result.ok;
}

export function browserLaunchEventFromResult(
  result: BrowserLaunchResult,
  metadata: {
    profileName: string;
    sourceLabel: string;
    url: string;
  }
): BrowserLaunchEvent {
  return {
    profileId: result.profileId,
    profileName: metadata.profileName,
    sourceLabel: metadata.sourceLabel,
    url: metadata.url,
    ok: result.ok,
    message: result.ok ? "已启动" : result.message,
    finishedAt: result.finishedAt
  };
}

export function appendBrowserLaunchEvents(
  currentEvents: BrowserLaunchEvent[],
  incomingEvents: BrowserLaunchEvent[],
  maxEvents = MAX_BROWSER_LAUNCH_EVENTS
): BrowserLaunchEvent[] {
  return normalizeBrowserLaunchEvents([...incomingEvents, ...currentEvents], maxEvents);
}

export function normalizeBrowserLaunchEvents(
  rawEvents: unknown,
  maxEvents = MAX_BROWSER_LAUNCH_EVENTS
): BrowserLaunchEvent[] {
  if (!Array.isArray(rawEvents) || maxEvents <= 0) {
    return [];
  }

  return rawEvents
    .map((event) => normalizeBrowserLaunchEvent(event))
    .filter((event): event is BrowserLaunchEvent => event !== null)
    .sort((left, right) => right.finishedAt - left.finishedAt)
    .slice(0, maxEvents);
}

function normalizeBrowserLaunchEvent(event: unknown): BrowserLaunchEvent | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const candidate = event as Partial<BrowserLaunchEvent>;
  const profileId = normalizeLaunchEventText(candidate.profileId);
  const finishedAt =
    typeof candidate.finishedAt === "number" && Number.isFinite(candidate.finishedAt)
      ? candidate.finishedAt
      : null;
  if (!profileId || finishedAt === null) {
    return null;
  }

  const ok = candidate.ok === true;
  return {
    profileId,
    profileName: normalizeLaunchEventText(candidate.profileName) || profileId,
    sourceLabel: normalizeLaunchEventText(candidate.sourceLabel) || "未知来源",
    url: normalizeLaunchEventText(candidate.url) || "chrome://newtab/",
    ok,
    message:
      normalizeLaunchEventText(candidate.message) || (ok ? "已启动" : "启动失败"),
    finishedAt
  };
}

function normalizeLaunchEventText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function summarizeBrowserLaunchResults(
  results: BrowserLaunchResult[],
  profileNameById: ReadonlyMap<string, string>
): BrowserLaunchSummary {
  const failures = results
    .filter((result): result is Extract<BrowserLaunchResult, { ok: false }> => !result.ok)
    .map((result) => ({
      profileId: result.profileId,
      profileName: profileNameById.get(result.profileId) ?? result.profileId,
      message: result.message
    }));

  return {
    totalCount: results.length,
    successCount: results.length - failures.length,
    failureCount: failures.length,
    failures
  };
}

export function formatBrowserLaunchFailureDetails(
  summary: BrowserLaunchSummary,
  maxDetails = 2
): string {
  if (summary.failureCount === 0) {
    return "";
  }

  const details = summary.failures
    .slice(0, maxDetails)
    .map((failure) => `${failure.profileName}：${failure.message}`)
    .join("；");
  const hiddenCount = summary.failureCount - maxDetails;
  const hiddenLabel = hiddenCount > 0 ? `；另 ${hiddenCount} 个失败` : "";

  return `${summary.failureCount} 个失败（${details}${hiddenLabel}）`;
}

export function summarizeBrowserLaunchQueue(
  results: BrowserLaunchResult[],
  profileNameById: ReadonlyMap<string, string>,
  queuedCount: number,
  stopped: boolean
): BrowserLaunchQueueSummary {
  return {
    ...summarizeBrowserLaunchResults(results, profileNameById),
    queuedCount,
    stopped
  };
}

export function formatBulkLaunchQueueMessage(
  summary: BrowserLaunchQueueSummary
): string {
  if (summary.stopped) {
    return `已停止，已打开 ${summary.successCount} / ${summary.queuedCount} 个账号`;
  }

  if (summary.failureCount > 0 && summary.successCount === 0) {
    return `打开网址失败：${formatBrowserLaunchFailureDetails(summary)}`;
  }

  if (summary.failureCount > 0) {
    return `已为 ${summary.successCount} 个账号打开网址，${formatBrowserLaunchFailureDetails(summary)}`;
  }

  return `已为 ${summary.successCount} 个账号打开网址`;
}

export function formatProjectLaunchQueueMessage(
  summary: BrowserLaunchQueueSummary,
  projectName: string,
  detailsLabel = ""
): string {
  if (summary.stopped) {
    return `已停止项目 ${projectName}，已打开 ${summary.successCount} / ${summary.queuedCount} 个账号`;
  }

  const failureLabel =
    summary.failureCount > 0
      ? `，${formatBrowserLaunchFailureDetails(summary)}`
      : "";
  return `已打开项目 ${projectName}：${summary.successCount} 个账号${detailsLabel}${failureLabel}`;
}

export function selectRetryableBrowserLaunchProfileIds(
  results: BrowserLaunchResult[],
  queuedProfileIds: string[]
): string[] {
  const latestResultByProfileId = new Map<string, BrowserLaunchResult>();
  for (const result of results) {
    latestResultByProfileId.set(result.profileId, result);
  }

  return queuedProfileIds.filter((profileId) => {
    const result = latestResultByProfileId.get(profileId);
    return result ? !result.ok : false;
  });
}
