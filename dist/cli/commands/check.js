"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCheckCommand = buildCheckCommand;
const commander_1 = require("commander");
const env_1 = require("../../config/env");
const runtime_1 = require("../../utils/runtime");
function buildCheckCommand() {
    const cmd = new commander_1.Command("check");
    cmd.description("Validate environment and runtime dependencies").action(async () => {
        try {
            const tidalEnv = (0, env_1.getRequiredTidalEnv)();
            const mode = tidalEnv.tidalAccessToken ? "access-token" : "client-credentials";
            console.log(`TIDAL env vars: OK (${mode})`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`TIDAL env vars: FAIL (${message})`);
        }
        const optional = (0, env_1.getOptionalEnv)();
        console.log(`Output dir: ${optional.outputDir}`);
        const deps = await (0, runtime_1.getRuntimeDependencyStatus)();
        console.log(`yt-dlp: ${deps.ytDlpAvailable ? "OK" : "MISSING (install with: sudo pacman -S yt-dlp)"}`);
        console.log(`ffmpeg: ${deps.ffmpegAvailable ? "OK" : "MISSING (install with: sudo pacman -S ffmpeg)"}`);
    });
    return cmd;
}
