"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAlbumCommand = buildAlbumCommand;
const commander_1 = require("commander");
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs"));
const tidal_1 = require("../../api/tidal");
const consent_1 = require("../../config/consent");
const youtube_1 = require("../../api/youtube");
const downloader_1 = require("../../download/downloader");
const tagger_1 = require("../../metadata/tagger");
const env_1 = require("../../config/env");
function sanitize(name) {
    return name.replace(/[<>:"/\\|?*]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 200);
}
function emitProgress(data) {
    console.log(`__PROGRESS__${JSON.stringify(data)}__END_PROGRESS__`);
}
function buildAlbumCommand() {
    const cmd = new commander_1.Command("album");
    cmd
        .description("Download a TIDAL album as MP3s with metadata")
        .argument("<album>", "TIDAL album URL or ID")
        .option("--dry-run", "Search and match only, do not download")
        .option("--skip-tags", "Skip ID3 tag writing")
        .action(async (album, opts) => {
        await (0, consent_1.assertConsent)();
        const env = (0, env_1.getOptionalEnv)();
        const outputDir = path.resolve(env.outputDir);
        emitProgress({ phase: "fetching", message: "Fetching album from TIDAL..." });
        const data = await (0, tidal_1.getTidalAlbum)(album);
        console.log(`Album:    ${data.title}`);
        console.log(`Artist:   ${data.artists.join(", ") || "Unknown"}`);
        console.log(`Tracks:   ${data.tracks.length}`);
        console.log(`Output:   ${outputDir}`);
        console.log("");
        emitProgress({ phase: "starting", total: data.tracks.length, name: `${data.artists.join(", ")} - ${data.title}` });
        const albumDir = path.join(outputDir, sanitize(`${data.artists.join(", ")} - ${data.title}`));
        if (!opts.dryRun) {
            fs.mkdirSync(albumDir, { recursive: true });
        }
        const results = [];
        for (let i = 0; i < data.tracks.length; i++) {
            const track = data.tracks[i];
            const num = String(i + 1).padStart(String(data.tracks.length).length, "0");
            const label = `[${num}/${data.tracks.length}] ${track.artists.join(", ")} - ${track.title}`;
            const fileName = `${num} ${sanitize(track.artists.join(", "))} - ${sanitize(track.title)}.mp3`;
            const filePath = path.join(albumDir, fileName);
            process.stdout.write(`${label} ... `);
            emitProgress({ phase: "track", current: i + 1, total: data.tracks.length, title: track.title, artists: track.artists, status: "searching" });
            // If file already exists, skip search + download, just update tags
            const fileExists = !opts.dryRun && fs.existsSync(filePath);
            if (!fileExists) {
                let candidates;
                try {
                    candidates = await (0, youtube_1.searchCandidates)(track);
                }
                catch {
                    candidates = [];
                }
                const best = (0, youtube_1.pickBestCandidate)(track, candidates);
                if (!best) {
                    console.log("NO MATCH");
                    emitProgress({ phase: "track", current: i + 1, total: data.tracks.length, title: track.title, artists: track.artists, status: "no-match" });
                    results.push({ track, status: "no-match" });
                    continue;
                }
                if (opts.dryRun) {
                    console.log(`MATCH -> ${best.title} (${best.durationSec}s)`);
                    results.push({ track, status: "ok" });
                    continue;
                }
                emitProgress({ phase: "track", current: i + 1, total: data.tracks.length, title: track.title, artists: track.artists, status: "downloading" });
                try {
                    await (0, downloader_1.runDownloadJob)({ sourceUrl: best.sourceUrl, outputPath: filePath });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.log("DOWNLOAD FAILED");
                    emitProgress({ phase: "track", current: i + 1, total: data.tracks.length, title: track.title, artists: track.artists, status: "download-fail" });
                    results.push({ track, status: "download-fail", error: msg });
                    continue;
                }
            }
            else {
                process.stdout.write("EXISTS, updating tags ... ");
                emitProgress({ phase: "track", current: i + 1, total: data.tracks.length, title: track.title, artists: track.artists, status: "exists" });
            }
            if (!opts.skipTags) {
                try {
                    await (0, tagger_1.writeTags)(filePath, {
                        title: track.title,
                        artists: track.artists,
                        album: data.title,
                        albumArtist: data.artists.join(", ") || track.artists.join(", "),
                        trackNumber: track.trackNumber || (i + 1),
                        discNumber: track.discNumber,
                        year: track.year || data.year,
                        coverUrl: track.coverUrl || data.coverUrl,
                    });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    console.log("TAG FAILED (file saved)");
                    emitProgress({ phase: "track", current: i + 1, total: data.tracks.length, title: track.title, artists: track.artists, status: "tag-fail" });
                    results.push({ track, status: "tag-fail", file: filePath, error: msg });
                    continue;
                }
            }
            console.log("OK");
            emitProgress({ phase: "track", current: i + 1, total: data.tracks.length, title: track.title, artists: track.artists, status: "ok" });
            results.push({ track, status: "ok", file: filePath });
        }
        console.log("");
        console.log("=== Album Download Summary ===");
        const ok = results.filter(r => r.status === "ok").length;
        const noMatch = results.filter(r => r.status === "no-match").length;
        const dlFail = results.filter(r => r.status === "download-fail").length;
        const tagFail = results.filter(r => r.status === "tag-fail").length;
        console.log(`  Completed: ${ok}`);
        if (noMatch > 0)
            console.log(`  No match:  ${noMatch}`);
        if (dlFail > 0)
            console.log(`  DL failed: ${dlFail}`);
        if (tagFail > 0)
            console.log(`  Tag error: ${tagFail}`);
        if (!opts.dryRun)
            console.log(`  Output:    ${albumDir}`);
        const jsonSummary = JSON.stringify({
            playlist: `${data.artists.join(", ")} - ${data.title}`,
            outputDir: albumDir,
            total: data.tracks.length,
            completed: ok,
            noMatch,
            downloadFailed: dlFail,
            tagFailed: tagFail,
            tracks: results.map(r => ({
                title: r.track.title,
                artists: r.track.artists,
                status: r.status,
                file: r.file ? path.basename(r.file) : undefined,
            })),
        });
        console.log(`\n__JSON_SUMMARY__${jsonSummary}__END_JSON__`);
    });
    return cmd;
}
