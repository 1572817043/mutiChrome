import type { UrlLibraryItem } from "../types";
import { normalizeLaunchUrl } from "../shared/urlHelpers";

export type UrlLibraryDraft = Pick<UrlLibraryItem, "name" | "url" | "notes"> & {
  tags: string;
};

export function createUrlLibraryDraft(
  item?: UrlLibraryItem | null
): UrlLibraryDraft {
  return {
    name: item?.name ?? "",
    url: item?.url ?? "",
    tags: item?.tags.join(", ") ?? "",
    notes: item?.notes ?? ""
  };
}

export function createUrlLibraryItem(
  item: Pick<UrlLibraryItem, "name" | "url" | "tags" | "notes">,
  existingItems: UrlLibraryItem[],
  now: string
): UrlLibraryItem {
  return {
    id: nextUrlLibraryId(existingItems),
    name: item.name,
    url: normalizeLaunchUrl(item.url),
    tags: [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))],
    notes: item.notes,
    createdAt: now,
    updatedAt: now
  };
}

export function parseUrlTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ];
}

function nextUrlLibraryId(items: UrlLibraryItem[]): string {
  const usedIds = new Set(items.map((item) => item.id));
  let index = items.length + 1;
  let id = `url-${String(index).padStart(3, "0")}`;
  while (usedIds.has(id)) {
    index += 1;
    id = `url-${String(index).padStart(3, "0")}`;
  }
  return id;
}
