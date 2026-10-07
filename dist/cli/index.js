#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const auth_1 = require("./commands/auth");
const check_1 = require("./commands/check");
const consent_1 = require("./commands/consent");
const download_1 = require("./commands/download");
const album_1 = require("./commands/album");
const artist_1 = require("./commands/artist");
const logger_1 = require("../utils/logger");
async function main() {
    const program = new commander_1.Command();
    program
        .name("musicer")
        .description("TIDAL playlist to YouTube/MP3 downloader")
        .version("0.1.0");
    program.addCommand((0, consent_1.buildConsentCommand)());
    program.addCommand((0, check_1.buildCheckCommand)());
    program.addCommand((0, auth_1.buildAuthCommand)());
    program.addCommand((0, download_1.buildDownloadCommand)());
    program.addCommand((0, album_1.buildAlbumCommand)());
    program.addCommand((0, artist_1.buildArtistCommand)());
    await program.parseAsync(process.argv);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger_1.logger.error(message);
    process.exitCode = 1;
});
