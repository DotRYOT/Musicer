"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAuthCommand = buildAuthCommand;
const commander_1 = require("commander");
const env_1 = require("../../config/env");
function buildAuthCommand() {
    const cmd = new commander_1.Command("auth");
    cmd
        .command("login")
        .description("Show TIDAL auth configuration guidance")
        .action(() => {
        const env = (0, env_1.getRequiredTidalEnv)();
        const mode = env.tidalAccessToken ? "access-token" : "client-credentials";
        console.log(`TIDAL auth configured: ${mode}`);
        if (mode === "access-token") {
            console.log("Using TIDAL_ACCESS_TOKEN from .env");
        }
        else {
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
