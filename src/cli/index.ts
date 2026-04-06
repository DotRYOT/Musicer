#!/usr/bin/env node
import { Command } from "commander";
import { buildAuthCommand } from "./commands/auth";
import { buildCheckCommand } from "./commands/check";
import { buildConsentCommand } from "./commands/consent";
import { buildDownloadCommand } from "./commands/download";
import { buildAlbumCommand } from "./commands/album";
import { buildArtistCommand } from "./commands/artist";
import { logger } from "../utils/logger";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("musicer")
    .description("TIDAL playlist to YouTube/MP3 downloader")
    .version("0.1.0");

  program.addCommand(buildConsentCommand());
  program.addCommand(buildCheckCommand());
  program.addCommand(buildAuthCommand());
  program.addCommand(buildDownloadCommand());
  program.addCommand(buildAlbumCommand());
  program.addCommand(buildArtistCommand());

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message);
  process.exitCode = 1;
});
