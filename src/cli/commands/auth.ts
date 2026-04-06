import { Command } from "commander";
import { getRequiredTidalEnv } from "../../config/env";

export function buildAuthCommand(): Command {
  const cmd = new Command("auth");

  cmd
    .command("login")
    .description("Show TIDAL auth configuration guidance")
    .action(() => {
      const env = getRequiredTidalEnv();
      const mode = env.tidalAccessToken ? "access-token" : "client-credentials";
      console.log(`TIDAL auth configured: ${mode}`);
      if (mode === "access-token") {
        console.log("Using TIDAL_ACCESS_TOKEN from .env");
      } else {
        console.log("Using TIDAL_CLIENT_ID + TIDAL_CLIENT_SECRET (auto token exchange)");
      }
    });

  cmd
    .command("complete")
    .description("No-op for TIDAL in this CLI")
    .action(() => {
      console.log("TIDAL does not require auth code completion in this CLI.");
      console.log("Set TIDAL_ACCESS_TOKEN or TIDAL_CLIENT_ID/TIDAL_CLIENT_SECRET in .env.");
    });

  return cmd;
}
