import {
  clickSelector,
  collectActionResults,
  connectToTarget,
  getFirstPageTarget,
  navigateTarget,
  profileConfigs,
  readPageState,
  startStaticServer,
  typeText,
} from "./lib.mjs";

const server = await startStaticServer();

try {
  const results = await collectActionResults(
    profileConfigs.map((profile) => ({
      profileId: profile.profileId,
      run: async () => {
        const target = await getFirstPageTarget(profile.port);
        const client = await connectToTarget(target);

        try {
          await navigateTarget(client, server.urlForMode(profile.mode));
          const before = await readPageState(client);
          await clickSelector(client, "#primary-action");
          await typeText(client, "#message-input", `hello from ${profile.profileId}`);
          const after = await readPageState(client);

          return {
            port: profile.port,
            mode: profile.mode,
            before,
            after,
          };
        } finally {
          client.close();
        }
      },
    })),
  );

  console.log(JSON.stringify(results, null, 2));
} finally {
  await server.close();
}
