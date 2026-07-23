export function availableScreenWidth(): number {
  return Math.max(1, window.screen.availWidth || window.innerWidth || 1);
}

export function availableScreenHeight(): number {
  return Math.max(1, window.screen.availHeight || window.innerHeight || 1);
}

export function availableScreenLeft(): number {
  return finiteScreenOffset(screenOffset("availLeft"));
}

export function availableScreenTop(): number {
  return finiteScreenOffset(screenOffset("availTop"));
}

function screenOffset(property: "availLeft" | "availTop"): number {
  const screenWithOffsets = window.screen as Screen &
    Partial<Record<"availLeft" | "availTop", number>>;
  return screenWithOffsets[property] ?? 0;
}

function finiteScreenOffset(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
