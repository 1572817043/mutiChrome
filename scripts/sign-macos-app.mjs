import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (process.platform !== "darwin") {
  process.exit(0);
}

const appPath = resolve(
  "src-tauri/target/release/bundle/macos/MultiChrome.app"
);

if (!existsSync(appPath)) {
  throw new Error(`MultiChrome.app 不存在：${appPath}`);
}

execFileSync(
  "codesign",
  ["--force", "--deep", "--sign", "-", "--identifier", "app.multichrome.desktop", appPath],
  { stdio: "inherit" }
);
