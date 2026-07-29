import { describe, expect, test } from "vitest";
import {
  createEmptyProfileDocument,
  normalizeProfileDocument
} from "./profileDocumentModel";
import type { ProfileDocument } from "../types";

describe("profileDocumentModel", () => {
  test("createEmptyProfileDocument builds the default browser document", () => {
    expect(createEmptyProfileDocument()).toEqual({
      version: 1,
      settings: {
        browserPath: "/Applications/Google Chrome.app",
        favoriteUrls: [],
        recentUrls: [],
        urlLibrary: [],
        theme: "light"
      },
      profiles: [],
      projects: []
    });
  });

  test("normalizeProfileDocument migrates legacy favorite urls into url library", () => {
    const document = partialDocument({
      settings: {
        browserPath: "  ",
        favoriteUrls: [" galxe.com ", "https://galxe.com", "zealy.io/path"],
        recentUrls: ["example.com", " example.com ", "https://x.com"],
        theme: "dark"
      }
    });

    expect(normalizeProfileDocument(document).settings).toEqual({
      browserPath: "/Applications/Google Chrome.app",
      favoriteUrls: ["https://galxe.com", "https://zealy.io/path"],
      recentUrls: ["https://example.com", "https://x.com"],
      urlLibrary: [
        {
          id: "url-001",
          name: "galxe.com",
          url: "https://galxe.com",
          tags: [],
          notes: "",
          createdAt: "",
          updatedAt: ""
        },
        {
          id: "url-002",
          name: "zealy.io/path",
          url: "https://zealy.io/path",
          tags: [],
          notes: "",
          createdAt: "",
          updatedAt: ""
        }
      ],
      theme: "dark"
    });
  });

  test("normalizeProfileDocument keeps normalized url library ahead of legacy favorites", () => {
    const document = partialDocument({
      settings: {
        favoriteUrls: ["legacy.example"],
        urlLibrary: [
          {
            id: " link ",
            name: "  ",
            url: "debank.com/profile?tab=quest",
            tags: [" defi ", "defi", ""],
            notes: 12,
            createdAt: "2026-07-01",
            updatedAt: undefined
          },
          {
            id: "link",
            name: "Duplicate",
            url: "https://debank.com/profile?tab=quest",
            tags: [],
            notes: "",
            createdAt: "",
            updatedAt: ""
          },
          {
            id: "link",
            name: "Layer3",
            url: "layer3.xyz",
            tags: [" quest "],
            notes: " keep ",
            createdAt: "",
            updatedAt: "2026-07-02"
          }
        ]
      }
    });

    expect(normalizeProfileDocument(document).settings).toMatchObject({
      favoriteUrls: [
        "https://debank.com/profile?tab=quest",
        "https://layer3.xyz"
      ],
      urlLibrary: [
        {
          id: "link",
          name: "debank.com/profile?tab=quest",
          url: "https://debank.com/profile?tab=quest",
          tags: ["defi"],
          notes: "",
          createdAt: "2026-07-01",
          updatedAt: "2026-07-01"
        },
        {
          id: "link-2",
          name: "Layer3",
          url: "https://layer3.xyz",
          tags: ["quest"],
          notes: " keep ",
          createdAt: "",
          updatedAt: "2026-07-02"
        }
      ]
    });
  });

  test("normalizeProfileDocument preserves profile account and import compatibility", () => {
    const document = partialDocument({
      profiles: [
        {
          id: "account-001",
          name: "",
          tags: [" twitter ", "", "galxe"],
          notes: 42,
          status: "paused",
          accountPlatforms: [
            {
              id: "platform-001",
              platform: " X ",
              loginUrl: "x.com/login",
              username: " user ",
              notes: " main "
            },
            { id: 9, platform: "bad" }
          ],
          accentColor: "teal",
          importSource: {
            profileUid: " uid ",
            sourcePath: " /tmp/Profile 1 ",
            sourceFolderName: " Profile 1 ",
            importedAt: " 2026-07-28 "
          },
          createdAt: 123,
          updatedAt: "2026-07-28",
          lastOpenedAt: undefined
        }
      ]
    });

    expect(normalizeProfileDocument(document).profiles).toEqual([
      {
        id: "account-001",
        name: "account-001",
        tags: [" twitter ", "galxe"],
        notes: "",
        status: "active",
        accountPlatforms: [
          {
            id: "platform-001",
            platform: "X",
            loginUrl: "https://x.com/login",
            username: "user",
            notes: "main"
          }
        ],
        accentColor: "teal",
        importSource: {
          profileUid: "uid",
          sourcePath: "/tmp/Profile 1",
          sourceFolderName: "Profile 1",
          importedAt: "2026-07-28"
        },
        createdAt: "",
        updatedAt: "2026-07-28",
        lastOpenedAt: null
      }
    ]);
  });

  test("normalizeProfileDocument migrates legacy project url and interval fallback", () => {
    const document = partialDocument({
      projects: [
        {
          id: "project-001",
          name: "",
          url: "galxe.com/campaign",
          urls: [],
          notes: 7,
          profileIds: ["account-001", "account-001", "", "account-002"],
          intervalSeconds: 120.7,
          createdAt: undefined,
          updatedAt: "2026-07-28",
          lastOpenedAt: undefined
        },
        {
          id: "project-002",
          name: "Layer3",
          url: "legacy.example",
          urls: [
            { id: "url-001", name: "", url: "layer3.xyz", notes: " go " },
            { id: "url-001", name: "Second", url: "", notes: 1 }
          ],
          notes: "keep",
          profileIds: "bad",
          intervalSeconds: Number.NaN,
          createdAt: "2026-07-01",
          updatedAt: "2026-07-02",
          lastOpenedAt: "2026-07-03"
        }
      ]
    });

    expect(normalizeProfileDocument(document).projects).toEqual([
      {
        id: "project-001",
        name: "project-001",
        url: "https://galxe.com/campaign",
        urls: [
          {
            id: "url-001",
            name: "主入口",
            url: "https://galxe.com/campaign",
            notes: ""
          }
        ],
        notes: "",
        profileIds: ["account-001", "account-002"],
        intervalSeconds: 60,
        createdAt: "",
        updatedAt: "2026-07-28",
        lastOpenedAt: null
      },
      {
        id: "project-002",
        name: "Layer3",
        url: "https://layer3.xyz",
        urls: [
          {
            id: "url-001",
            name: "网址 1",
            url: "https://layer3.xyz",
            notes: "go"
          },
          {
            id: "url-002",
            name: "Second",
            url: "",
            notes: ""
          }
        ],
        notes: "keep",
        profileIds: [],
        intervalSeconds: 3,
        createdAt: "2026-07-01",
        updatedAt: "2026-07-02",
        lastOpenedAt: "2026-07-03"
      }
    ]);
  });
});

function partialDocument(
  overrides: Record<string, unknown> = {}
): ProfileDocument {
  return {
    version: 1,
    settings: {},
    profiles: [],
    projects: [],
    ...overrides
  } as unknown as ProfileDocument;
}
