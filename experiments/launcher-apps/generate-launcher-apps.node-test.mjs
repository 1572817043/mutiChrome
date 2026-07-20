import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildIcns,
  buildInfoPlist,
  buildLaunchScript,
  buildOsacompileArgs,
  buildStayOpenAppleScript,
  createLauncherSpecs,
  parseLauncherArgs,
  shellQuote,
} from "./generate-launcher-apps.mjs";

describe("launcher app generator", () => {
  it("builds one app spec per profile with stable unique bundle identity", () => {
    const specs = createLauncherSpecs({
      rootDir: "/tmp/MultiChromeProfiles",
      outputDir: "/tmp/launchers",
      chromeAppPath: "/Applications/Google Chrome.app",
      launcherMode: "launch-once",
      profiles: [
        { id: "account-001", displayName: "main" },
        { id: "account-002", displayName: "draw" },
      ],
    });

    assert.equal(specs.length, 2);
    assert.equal(specs[0].appName, "MC-account-001");
    assert.equal(specs[0].bundleId, "app.multichrome.launcher.account-001");
    assert.equal(specs[0].launcherMode, "launch-once");
    assert.equal(specs[0].profileDir, "/tmp/MultiChromeProfiles/profiles/account-001");
    assert.notEqual(specs[0].iconColor, specs[1].iconColor);
  });

  it("builds a launcher script that opens Chrome with the profile directory only", () => {
    const script = buildLaunchScript({
      chromeAppPath: "/Applications/Google Chrome.app",
      profileDir: "/tmp/root/profiles/account 001",
    });

    assert.match(script, /^#!\/bin\/zsh/);
    assert.match(script, /open -n -a/);
    assert.match(script, /--user-data-dir=\/tmp\/root\/profiles\/account 001/);
    assert.match(script, /--no-first-run/);
    assert.doesNotMatch(script, /about:blank/);
  });

  it("builds a stay-open AppleScript helper that handles Dock clicks", () => {
    const script = buildStayOpenAppleScript({
      id: "account-001",
      chromeAppPath: "/Applications/Google Chrome.app",
      profileDir: "/tmp/root/profiles/account-001",
    });

    assert.match(script, /on run/);
    assert.match(script, /on reopen/);
    assert.match(script, /on idle/);
    assert.match(script, /handleActivate/);
    assert.match(script, /pgrep -f --/);
    assert.match(script, /System Events/);
    assert.match(script, /frontmost of first process whose unix id/);
    assert.doesNotMatch(script, /about:blank/);
  });

  it("builds a stay-open app plist that uses the AppleScript applet executable", () => {
    const plist = buildInfoPlist({
      appName: "MC-account-001",
      bundleId: "app.multichrome.launcher.account-001",
      executable: "applet",
    });

    assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>applet<\/string>/);
  });

  it("compiles stay-open helpers as stay-open AppleScript applets", () => {
    const args = buildOsacompileArgs({
      appPath: "/tmp/MC-account-001.app",
      scriptPath: "/tmp/account-001.applescript",
      launcherMode: "stay-open",
    });

    assert.deepEqual(args, ["-s", "-o", "/tmp/MC-account-001.app", "/tmp/account-001.applescript"]);
  });

  it("parses stay-open mode from cli args", () => {
    const options = parseLauncherArgs([
      "--root",
      "/tmp/root",
      "--out",
      "/tmp/out",
      "--mode",
      "stay-open",
      "--profiles",
      "account-001",
    ]);

    assert.equal(options.launcherMode, "stay-open");
    assert.equal(options.profiles.length, 1);
    assert.equal(options.profiles[0].id, "account-001");
  });

  it("escapes paths safely for zsh launcher scripts", () => {
    assert.equal(shellQuote("/tmp/a'b"), "'/tmp/a'\\''b'");
  });

  it("writes the expected app identity into Info.plist", () => {
    const plist = buildInfoPlist({
      appName: "MC-account-001",
      bundleId: "app.multichrome.launcher.account-001",
    });

    assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>launcher<\/string>/);
    assert.match(plist, /<key>CFBundleIdentifier<\/key>\s*<string>app\.multichrome\.launcher\.account-001<\/string>/);
    assert.match(plist, /<key>CFBundleIconFile<\/key>\s*<string>AppIcon<\/string>/);
  });

  it("builds an icns container directly for generated app icons", () => {
    const icon = buildIcns({ color: "#1f7a4f", label: "01" });

    assert.equal(icon.subarray(0, 4).toString("ascii"), "icns");
    assert.equal(icon.readUInt32BE(4), icon.length);
    assert.match(icon.toString("latin1"), /icp4/);
    assert.match(icon.toString("latin1"), /ic10/);
  });
});
