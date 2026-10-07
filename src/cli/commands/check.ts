import { Command } from "commander";
import { getOptionalEnv, getRequiredTidalEnv } from "../../config/env";
import { getRuntimeDependencyStatus } from "../../utils/runtime";

export function buildCheckCommand(): Command {
  const cmd = new Command("check");

  cmd.description("Validate environment and runtime dependencies").action(async () => {
    try {
      const tidalEnv = getRequiredTidalEnv();
      const mode = tidalEnv.tidalAccessToken ? "access-token" : "client-credentials";
      console.log(`TIDAL env vars: OK (${mode})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`TIDAL env vars: FAIL (${message})`);
    }

    const optional = getOptionalEnv();
    console.log(`Output dir: ${optional.outputDir}`);

    const deps = await getRuntimeDependencyStatus();
    console.log(`yt-dlp: ${deps.ytDlpAvailable ? "OK" : "MISSING (install with: sudo pacman -S yt-dlp)"}`);
    console.log(`ffmpeg: ${deps.ffmpegAvailable ? "OK" : "MISSING (install with: sudo pacman -S ffmpeg)"}`);
  });

  return cmd;
}
