import { describe, expect, test } from "vitest";
import {
  cloneProjectForDraft,
  createProject,
  parseProjectUrlImportLines,
  projectEditableUrls,
  projectOpenUrls,
  updateProject
} from "./projectModel";
import type { AirdropProject } from "../types";

const now = "2026-07-23T10:00:00.000Z";

describe("projectModel", () => {
  test("projectEditableUrls keeps legacy single-url projects editable", () => {
    const project = airdropProject({
      url: "galxe.com",
      urls: []
    });

    expect(projectEditableUrls(project)).toEqual([
      {
        id: "url-001",
        name: "主入口",
        url: "https://galxe.com",
        notes: ""
      }
    ]);
  });

  test("projectOpenUrls ignores empty structured urls and falls back to legacy url", () => {
    const project = airdropProject({
      url: "zealy.io",
      urls: [{ id: "url-001", name: "主入口", url: "   ", notes: "" }]
    });

    expect(projectOpenUrls(project)).toEqual([
      {
        id: "url-001",
        name: "主入口",
        url: "https://zealy.io",
        notes: ""
      }
    ]);
  });

  test("createProject initializes the first structured project url", () => {
    expect(createProject([], ["account-001", "account-001"], now)).toMatchObject({
      id: "project-001",
      name: "项目 1",
      url: "",
      urls: [{ id: "url-001", name: "主入口", url: "", notes: "" }],
      profileIds: ["account-001"],
      intervalSeconds: 3,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null
    });
  });

  test("updateProject keeps normalized primary url and interval bounds", () => {
    const project = airdropProject();

    expect(
      updateProject(project, { url: "example.com/path", intervalSeconds: 120 }, now)
    ).toMatchObject({
      url: "https://example.com/path",
      urls: [{ id: "url-001", name: "主入口", url: "example.com/path", notes: "" }],
      intervalSeconds: 60,
      updatedAt: now
    });
  });

  test("parseProjectUrlImportLines preserves names, labels and notes", () => {
    expect(
      parseProjectUrlImportLines(
        "Galxe https://galxe.com/campaign - 每日任务\nhttps://zealy.io/path),"
      )
    ).toEqual([
      {
        id: "url-001",
        name: "Galxe",
        url: "https://galxe.com/campaign",
        notes: "每日任务"
      },
      {
        id: "url-002",
        name: "zealy.io/path",
        url: "https://zealy.io/path",
        notes: ""
      }
    ]);
  });

  test("cloneProjectForDraft copies editable urls and profile ids", () => {
    const original = airdropProject({
      profileIds: ["account-001"],
      urls: [{ id: "url-001", name: "主入口", url: "galxe.com", notes: "" }]
    });

    const draft = cloneProjectForDraft(original);

    draft.profileIds.push("account-002");
    draft.urls[0].url = "zealy.io";
    expect(original.profileIds).toEqual(["account-001"]);
    expect(original.urls[0].url).toBe("galxe.com");
  });
});

function airdropProject(overrides: Partial<AirdropProject> = {}): AirdropProject {
  return {
    id: "project-001",
    name: "项目",
    url: "",
    urls: [{ id: "url-001", name: "主入口", url: "", notes: "" }],
    notes: "",
    profileIds: [],
    intervalSeconds: 3,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    lastOpenedAt: null,
    ...overrides
  };
}
