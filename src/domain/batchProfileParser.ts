export interface BatchProfileDraft {
  name: string;
  tags: string[];
  notes: string;
}

export function parseBatchProfileLines(value: string): BatchProfileDraft[] {
  return value
    .split(/\r?\n/)
    .map((line) => parseBatchProfileLine(line))
    .filter((profile): profile is BatchProfileDraft => Boolean(profile));
}

function parseBatchProfileLine(line: string): BatchProfileDraft | null {
  const cleanedLine = line.trim();
  if (!cleanedLine) {
    return null;
  }

  const parts = cleanedLine.includes("\t")
    ? cleanedLine.split("\t").map((part) => part.trim())
    : cleanedLine.includes("|")
      ? cleanedLine.split("|").map((part) => part.trim())
      : cleanedLine.split(/[,，]/).map((part) => part.trim());
  const [name = "", tagsRaw = "", ...noteParts] = parts;
  const cleanedName = name.trim();
  if (!cleanedName) {
    return null;
  }

  return {
    name: cleanedName,
    tags: parseBatchProfileTags(tagsRaw),
    notes: noteParts.join(", ").trim()
  };
}

function parseBatchProfileTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const tag of value.split(/[\s,，、;；]+/)) {
    const cleaned = tag.trim();
    if (!cleaned || seen.has(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    tags.push(cleaned);
  }

  return tags;
}
