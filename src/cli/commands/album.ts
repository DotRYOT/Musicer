import { Command } from "commander";
import * as path from "node:path";
import * as fs from "node:fs";
import { getTidalAlbum } from "../../api/tidal";
import { assertConsent } from "../../config/consent";
import { searchCandidates, pickBestCandidate, YouTubeCandidate } from "../../api/youtube";
import { runDownloadJob } from "../../download/downloader";
import { writeTags } from "../../metadata/tagger";
import { getOptionalEnv } from "../../config/env";
import { SourceTrack } from "../../types";

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 200);
}

function emitProgress(data: Record<string, unknown>): void {
  console.log(`__PROGRESS__${JSON.stringify(data)}__END_PROGRESS__`);
}

interface TrackResult {
  track: SourceTrack;
  status: "ok" | "no-match" | "download-fail" | "tag-fail";
  file?: string;
  error?: string;
}

export function buildAlbumCommand(): Command {
  const cmd = new Command("album");

  cmd
    .description("Download a TIDAL album as MP3s with metadata")
    .argument("<album>", "TIDAL album URL or ID")
    .option("--dry-run", "Search and match only, do not download")
    .option("--skip-tags", "Skip ID3 tag writing")
    .action(async (album: string, opts: { dryRun?: boolean; skipTags?: boolean }) => {
      await assertConsent();

      const env = getOptionalEnv();
      const outputDir = path.resolve(env.outputDir);

      emitProgress({ phase: "fetching", message: "Fetching album from TIDAL..." });
      const data = await getTidalAlbum(album);

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

      const results: TrackResult[] = [];

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
          let candidates: YouTubeCandidate[];
          try {
            candidates = await searchCandidates(track);
          } catch {
            candidates = [];
          }

          const best = pickBestCandidate(track, candidates);
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
            await runDownloadJob({ sourceUrl: best.sourceUrl, outputPath: filePath });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log("DOWNLOAD FAILED");
            emitProgress({ phase: "track", current: i + 1, total: data.tracks.length, title: track.title, artists: track.artists, status: "download-fail" });
            results.push({ track, status: "download-fail", error: msg });
            continue;
          }
        } else {
          process.stdout.write("EXISTS, updating tags ... ");
          emitProgress({ phase: "track", current: i + 1, total: data.tracks.length, title: track.title, artists: track.artists, status: "exists" });
        }

        if (!opts.skipTags) {
          try {
            await writeTags(filePath, {
              title: track.title,
              artists: track.artists,
              album: data.title,
              albumArtist: data.artists.join(", ") || track.artists.join(", "),
              trackNumber: track.trackNumber || (i + 1),
              discNumber: track.discNumber,
              year: track.year || data.year,
              coverUrl: track.coverUrl || data.coverUrl,
            });
          } catch (err) {
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
      if (noMatch > 0) console.log(`  No match:  ${noMatch}`);
      if (dlFail > 0) console.log(`  DL failed: ${dlFail}`);
      if (tagFail > 0) console.log(`  Tag error: ${tagFail}`);
      if (!opts.dryRun) console.log(`  Output:    ${albumDir}`);

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
