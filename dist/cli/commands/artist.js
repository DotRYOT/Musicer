"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildArtistCommand = buildArtistCommand;
const commander_1 = require("commander");
const tidal_1 = require("../../api/tidal");
const consent_1 = require("../../config/consent");
function buildArtistCommand() {
    const cmd = new commander_1.Command("artist");
    cmd
        .description("Search for a TIDAL artist and list their albums")
        .argument("<query>", "Artist name to search for")
        .action(async (query) => {
        await (0, consent_1.assertConsent)();
        console.log(`Searching TIDAL for "${query}"...`);
        const results = await (0, tidal_1.searchTidalArtists)(query);
        if (results.length === 0) {
            console.log("No artists found.");
            const jsonResult = JSON.stringify({ artists: [] });
            console.log(`\n__JSON_ARTIST_SEARCH__${jsonResult}__END_JSON__`);
            return;
        }
        for (const artist of results) {
            console.log(`\n=== ${artist.name} ===`);
            if (artist.albums.length === 0) {
                console.log("  No albums found.");
                continue;
            }
            for (const album of artist.albums) {
                const year = album.releaseDate ? ` (${album.releaseDate.slice(0, 4)})` : "";
                const count = album.trackCount ? ` [${album.trackCount} tracks]` : "";
                console.log(`  ${album.id} | ${album.title}${year}${count}`);
            }
        }
        const jsonResult = JSON.stringify({
            artists: results.map(a => ({
                id: a.id,
                name: a.name,
                imageUrl: a.imageUrl,
                albums: a.albums.map(al => ({
                    id: al.id,
                    title: al.title,
                    releaseDate: al.releaseDate,
                    coverUrl: al.coverUrl,
                    trackCount: al.trackCount,
                })),
            })),
        });
        console.log(`\n__JSON_ARTIST_SEARCH__${jsonResult}__END_JSON__`);
    });
    return cmd;
}
