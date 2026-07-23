import { afterEach, describe, expect, test, vi } from "vitest";
import {
  availableScreenHeight,
  availableScreenLeft,
  availableScreenTop,
  availableScreenWidth
} from "./screenWorkArea";

describe("screenWorkArea", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("uses screen available size when present", () => {
    vi.stubGlobal("window", {
      innerWidth: 900,
      innerHeight: 700,
      screen: {
        availWidth: 1440,
        availHeight: 900,
        availLeft: 40,
        availTop: 24
      }
    });

    expect(availableScreenWidth()).toBe(1440);
    expect(availableScreenHeight()).toBe(900);
    expect(availableScreenLeft()).toBe(40);
    expect(availableScreenTop()).toBe(24);
  });

  test("falls back to inner size and safe zero offsets in test-like screens", () => {
    vi.stubGlobal("window", {
      innerWidth: 1024,
      innerHeight: 768,
      screen: {
        availWidth: 0,
        availHeight: 0,
        availLeft: Number.NaN,
        availTop: undefined
      }
    });

    expect(availableScreenWidth()).toBe(1024);
    expect(availableScreenHeight()).toBe(768);
    expect(availableScreenLeft()).toBe(0);
    expect(availableScreenTop()).toBe(0);
  });
});
