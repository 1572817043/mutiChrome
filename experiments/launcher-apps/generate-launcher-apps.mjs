import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ICON_COLORS = [
  "#1f7a4f",
  "#0f8f8f",
  "#2563eb",
  "#7c3aed",
  "#b45309",
  "#be123c",
  "#0e7490",
  "#4f46e5",
];

const ICNS_ELEMENTS = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
];

const LAUNCHER_MODES = new Set(["launch-once", "stay-open"]);

const DIGITS = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "010", "010", "010"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
};

export function createLauncherSpecs({
  rootDir,
  outputDir,
  chromeAppPath,
  launcherMode = "launch-once",
  profiles,
}) {
  assertLauncherMode(launcherMode);

  return profiles.map((profile, index) => {
    const id = sanitizeProfileId(profile.id);
    const bundleSegment = toBundleSegment(id);
    const appName = `MC-${id}`;

    return {
      id,
      displayName: profile.displayName || id,
      appName,
      bundleId: `app.multichrome.launcher.${bundleSegment}`,
      appPath: path.join(outputDir, `${appName}.app`),
      chromeAppPath,
      iconColor: ICON_COLORS[index % ICON_COLORS.length],
      iconText: profile.iconText || iconTextForProfile(id, index),
      launcherMode,
      profileDir: path.join(rootDir, "profiles", id),
    };
  });
}

export function buildLaunchScript({ id = "launcher", chromeAppPath, launcherMode = "launch-once", profileDir }) {
  assertLauncherMode(launcherMode);

  if (launcherMode === "stay-open") {
    return buildStayOpenAppleScript({ id, chromeAppPath, profileDir });
  }

  return [
    "#!/bin/zsh",
    "set -e",
    `open -n -a ${shellQuote(chromeAppPath)} --args ${shellQuote(`--user-data-dir=${profileDir}`)} ${shellQuote("--no-first-run")}`,
    "",
  ].join("\n");
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function buildStayOpenAppleScript({ chromeAppPath, profileDir }) {
  const userDataArg = `--user-data-dir=${profileDir}`;

  return [
    `property chromeAppPath : ${appleScriptString(chromeAppPath)}`,
    `property userDataArg : ${appleScriptString(userDataArg)}`,
    "",
    "on run",
    "  handleActivate()",
    "end run",
    "",
    "on reopen",
    "  handleActivate()",
    "end reopen",
    "",
    "on idle",
    "  if chromeIsRunning() then",
    "    return 3",
    "  end if",
    "  quit",
    "  return 3",
    "end idle",
    "",
    "on handleActivate()",
    "  if chromeIsRunning() then",
    "    focusChrome()",
    "  else",
    "    launchChrome()",
    "  end if",
    "end handleActivate",
    "",
    "on chromePid()",
    "  try",
    "    return do shell script \"pgrep -f -- \" & quoted form of userDataArg & \" | head -n 1\"",
    "  on error",
    "    return \"\"",
    "  end try",
    "end chromePid",
    "",
    "on chromeIsRunning()",
    "  return chromePid() is not \"\"",
    "end chromeIsRunning",
    "",
    "on focusChrome()",
    "  set pidText to chromePid()",
    "  if pidText is \"\" then return false",
    "  try",
    "    tell application \"System Events\"",
    "      set frontmost of first process whose unix id is (pidText as integer) to true",
    "    end tell",
    "    return true",
    "  on error",
    "    return false",
    "  end try",
    "end focusChrome",
    "",
    "on launchChrome()",
    "  do shell script \"open -n -a \" & quoted form of chromeAppPath & \" --args \" & quoted form of userDataArg & \" '--no-first-run'\"",
    "end launchChrome",
    "",
  ].join("\n");
}

export function buildInfoPlist({ appName, bundleId, executable = "launcher" }) {
  const escapedAppName = xmlEscape(appName);
  const escapedBundleId = xmlEscape(bundleId);
  const escapedExecutable = xmlEscape(executable);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>${escapedAppName}</string>
  <key>CFBundleExecutable</key>
  <string>${escapedExecutable}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>${escapedBundleId}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${escapedAppName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
}

export function generateLauncherApps(options) {
  const specs = createLauncherSpecs(options);
  mkdirSync(options.outputDir, { recursive: true });

  for (const spec of specs) {
    writeLauncherApp(spec);
  }

  return specs;
}

function writeLauncherApp(spec) {
  const contentsDir = path.join(spec.appPath, "Contents");
  const macOsDir = path.join(contentsDir, "MacOS");
  const resourcesDir = path.join(contentsDir, "Resources");
  const markerPath = path.join(contentsDir, ".multichrome-launcher");

  if (existsSync(spec.appPath)) {
    if (!existsSync(markerPath)) {
      throw new Error(`Refusing to overwrite app without marker: ${spec.appPath}`);
    }
    rmSync(spec.appPath, { recursive: true, force: true });
  }

  if (spec.launcherMode === "stay-open") {
    writeStayOpenApp(spec);
    return;
  }

  mkdirSync(macOsDir, { recursive: true });
  mkdirSync(resourcesDir, { recursive: true });
  writeFileSync(path.join(contentsDir, "Info.plist"), buildInfoPlist(spec));
  writeFileSync(path.join(macOsDir, "launcher"), buildLaunchScript(spec), {
    mode: 0o755,
  });
  writeFileSync(markerPath, "generated by MultiChrome launcher experiment\n");
  writeIcon(spec, resourcesDir);
}

function writeStayOpenApp(spec) {
  const scriptPath = path.join(path.dirname(spec.appPath), `.${spec.id}.applescript`);
  writeFileSync(scriptPath, buildStayOpenAppleScript(spec));
  execFileSync("osacompile", buildOsacompileArgs({
    appPath: spec.appPath,
    scriptPath,
    launcherMode: spec.launcherMode,
  }), { stdio: "pipe" });
  rmSync(scriptPath, { force: true });

  const contentsDir = path.join(spec.appPath, "Contents");
  const resourcesDir = path.join(contentsDir, "Resources");
  mkdirSync(resourcesDir, { recursive: true });
  writeFileSync(path.join(contentsDir, "Info.plist"), buildInfoPlist({ ...spec, executable: "applet" }));
  writeFileSync(path.join(contentsDir, ".multichrome-launcher"), "generated by MultiChrome launcher experiment\n");
  writeIcon(spec, resourcesDir);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", spec.appPath], { stdio: "pipe" });
}

export function buildOsacompileArgs({ appPath, scriptPath, launcherMode }) {
  const args = [];
  if (launcherMode === "stay-open") {
    args.push("-s");
  }
  args.push("-o", appPath, scriptPath);
  return args;
}

function writeIcon(spec, resourcesDir) {
  const icnsPath = path.join(resourcesDir, "AppIcon.icns");

  writeFileSync(icnsPath, buildIcns({ color: spec.iconColor, label: spec.iconText }));
}

export function buildIcns({ color, label }) {
  const elements = ICNS_ELEMENTS.map(([type, size]) => {
    const png = createIconPng({ size, color, label });
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const totalLength = 8 + elements.reduce((sum, element) => sum + element.length, 0);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);
  return Buffer.concat([header, ...elements]);
}

function createIconPng({ size, color, label }) {
  const rgba = Buffer.alloc(size * size * 4);
  const [r, g, b] = hexToRgb(color);
  const radius = size * 0.22;
  const center = (size - 1) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const alpha = roundedRectAlpha(x, y, size, radius);
      const shade = 0.9 + 0.16 * (1 - y / Math.max(1, size - 1));
      const glow = Math.max(0, 1 - Math.hypot(x - center, y - center) / size) * 22;

      rgba[offset] = clamp(r * shade + glow);
      rgba[offset + 1] = clamp(g * shade + glow);
      rgba[offset + 2] = clamp(b * shade + glow);
      rgba[offset + 3] = alpha;
    }
  }

  drawProfileGlyph(rgba, size);
  drawDigitLabel(rgba, size, label);

  return encodePng(size, size, rgba);
}

function drawProfileGlyph(rgba, size) {
  const left = Math.round(size * 0.22);
  const top = Math.round(size * 0.22);
  const avatar = Math.round(size * 0.2);
  const cardWidth = Math.round(size * 0.56);
  const lineHeight = Math.max(2, Math.round(size * 0.055));

  drawRoundedRect(rgba, size, left, top, cardWidth, Math.round(size * 0.48), Math.round(size * 0.08), [255, 255, 255, 52]);
  drawCircle(rgba, size, left + avatar, top + Math.round(size * 0.19), Math.round(size * 0.08), [255, 255, 255, 210]);
  drawRoundedRect(
    rgba,
    size,
    left + Math.round(size * 0.11),
    top + Math.round(size * 0.32),
    Math.round(size * 0.18),
    Math.round(size * 0.1),
    Math.round(size * 0.04),
    [255, 255, 255, 185],
  );
  drawRoundedRect(
    rgba,
    size,
    left + Math.round(size * 0.34),
    top + Math.round(size * 0.17),
    Math.round(size * 0.26),
    lineHeight,
    Math.round(lineHeight / 2),
    [255, 255, 255, 205],
  );
  drawRoundedRect(
    rgba,
    size,
    left + Math.round(size * 0.34),
    top + Math.round(size * 0.3),
    Math.round(size * 0.2),
    lineHeight,
    Math.round(lineHeight / 2),
    [255, 255, 255, 120],
  );
}

function drawDigitLabel(rgba, size, label) {
  const text = String(label).slice(-2).padStart(2, "0");
  const scale = Math.max(1, Math.floor(size / 64));
  const gap = scale;
  const digitWidth = 3 * scale;
  const digitHeight = 5 * scale;
  const textWidth = digitWidth * text.length + gap * (text.length - 1);
  const badgePaddingX = Math.max(3, Math.round(size * 0.045));
  const badgePaddingY = Math.max(2, Math.round(size * 0.032));
  const badgeWidth = textWidth + badgePaddingX * 2;
  const badgeHeight = digitHeight + badgePaddingY * 2;
  const badgeX = size - badgeWidth - Math.round(size * 0.12);
  const badgeY = size - badgeHeight - Math.round(size * 0.12);

  drawRoundedRect(rgba, size, badgeX, badgeY, badgeWidth, badgeHeight, Math.round(badgeHeight / 2), [11, 38, 28, 220]);

  let cursorX = badgeX + badgePaddingX;
  const cursorY = badgeY + badgePaddingY;
  for (const char of text) {
    drawDigit(rgba, size, char, cursorX, cursorY, scale, [255, 255, 255, 245]);
    cursorX += digitWidth + gap;
  }
}

function drawDigit(rgba, size, digit, startX, startY, scale, color) {
  const pattern = DIGITS[digit] || DIGITS[0];

  for (let row = 0; row < pattern.length; row += 1) {
    for (let column = 0; column < pattern[row].length; column += 1) {
      if (pattern[row][column] !== "1") {
        continue;
      }
      drawRect(rgba, size, startX + column * scale, startY + row * scale, scale, scale, color);
    }
  }
}

function drawRoundedRect(rgba, size, x, y, width, height, radius, color) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      const dx = Math.max(x + radius - px, 0, px - (x + width - radius - 1));
      const dy = Math.max(y + radius - py, 0, py - (y + height - radius - 1));
      if (dx * dx + dy * dy <= radius * radius) {
        blendPixel(rgba, size, px, py, color);
      }
    }
  }
}

function drawRect(rgba, size, x, y, width, height, color) {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) {
      blendPixel(rgba, size, px, py, color);
    }
  }
}

function drawCircle(rgba, size, centerX, centerY, radius, color) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (dx * dx + dy * dy <= radius * radius) {
        blendPixel(rgba, size, x, y, color);
      }
    }
  }
}

function blendPixel(rgba, size, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) {
    return;
  }

  const offset = (y * size + x) * 4;
  const sourceAlpha = a / 255;
  const destAlpha = rgba[offset + 3] / 255;
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);

  rgba[offset] = clamp((r * sourceAlpha + rgba[offset] * destAlpha * (1 - sourceAlpha)) / outAlpha);
  rgba[offset + 1] = clamp((g * sourceAlpha + rgba[offset + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha);
  rgba[offset + 2] = clamp((b * sourceAlpha + rgba[offset + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha);
  rgba[offset + 3] = clamp(outAlpha * 255);
}

function roundedRectAlpha(x, y, size, radius) {
  const dx = Math.max(radius - x, 0, x - (size - radius - 1));
  const dy = Math.max(radius - y, 0, y - (size - radius - 1));
  return dx * dx + dy * dy <= radius * radius ? 255 : 0;
}

function encodePng(width, height, rgba) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * width * 4;
    const destStart = y * (width * 4 + 1);
    scanlines[destStart] = 0;
    rgba.copy(scanlines, destStart + 1, sourceStart, sourceStart + width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hexToRgb(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) {
    throw new Error(`Invalid color: ${hex}`);
  }
  return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)];
}

function sanitizeProfileId(id) {
  const value = String(id || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!value) {
    throw new Error("Profile id is required");
  }
  return value;
}

function toBundleSegment(value) {
  const segment = value.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(segment) ? segment : `profile-${segment}`;
}

function iconTextForProfile(id, index) {
  const suffix = id.match(/(\d+)$/)?.[1];
  return suffix || String(index + 1);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function appleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function assertLauncherMode(value) {
  if (!LAUNCHER_MODES.has(value)) {
    throw new Error(`Invalid launcher mode: ${value}`);
  }
}

function parseArgs(argv) {
  const options = {
    rootDir: path.join(homedir(), "MultiChromeProfiles"),
    outputDir: path.join(process.cwd(), ".launcher-experiment"),
    chromeAppPath: "/Applications/Google Chrome.app",
    launcherMode: "launch-once",
    profiles: [
      { id: "account-001", displayName: "account-001" },
      { id: "account-002", displayName: "account-002" },
    ],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--root") {
      options.rootDir = path.resolve(next);
      i += 1;
    } else if (arg === "--out") {
      options.outputDir = path.resolve(next);
      i += 1;
    } else if (arg === "--chrome") {
      options.chromeAppPath = next;
      i += 1;
    } else if (arg === "--mode") {
      assertLauncherMode(next);
      options.launcherMode = next;
      i += 1;
    } else if (arg === "--profiles") {
      options.profiles = next.split(",").map((id) => ({ id: id.trim(), displayName: id.trim() })).filter((profile) => profile.id);
      i += 1;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export const parseLauncherArgs = parseArgs;

function printHelp() {
  console.log(`Usage:
  node experiments/launcher-apps/generate-launcher-apps.mjs [options]

Options:
  --root <dir>          MultiChrome root directory. Defaults to ~/MultiChromeProfiles
  --out <dir>           Output directory. Defaults to ./.launcher-experiment
  --chrome <app>        Chrome.app path. Defaults to /Applications/Google Chrome.app
  --mode <mode>         launch-once or stay-open. Defaults to launch-once
  --profiles <ids>      Comma-separated profile ids. Defaults to account-001,account-002
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const specs = generateLauncherApps(options);

  for (const spec of specs) {
    console.log(`${spec.appPath}`);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
