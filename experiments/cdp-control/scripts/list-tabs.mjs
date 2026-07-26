import { listTabsForPort, profileConfigs } from "./lib.mjs";

const rows = [];

for (const profile of profileConfigs) {
  try {
    const tabs = await listTabsForPort(profile.port);
    for (const tab of tabs) {
      rows.push({
        profileId: profile.profileId,
        port: profile.port,
        title: tab.title,
        url: tab.url,
      });
    }
  } catch (error) {
    rows.push({
      profileId: profile.profileId,
      port: profile.port,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(JSON.stringify(rows, null, 2));
