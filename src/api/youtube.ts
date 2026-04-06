import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getOptionalEnv } from "../config/env";
import { SourceTrack } from "../types";

export interface YouTubeCandidate {
  title: string;
  artist: string;
  durationSec: number;
  sourceUrl: string;
}

function resolveYtDlp(): string {
  const env = getOptionalEnv();
  if (env.ytDlpPath) {
    const p = env.ytDlpPath.replace(/[\/]$/, "");
    return p.endsWith("yt-dlp") || p.endsWith("yt-dlp.exe") ? p : `${p}\\yt-dlp`;
  }
  const binExe = join(process.cwd(), "bin", "yt-dlp.exe");
  if (existsSync(binExe)) return binExe;
  return "yt-dlp";
}

function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(resolveYtDlp(), args, { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`yt-dlp failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export async function searchCandidates(track: SourceTrack, maxResults = 5): Promise<YouTubeCandidate[]> {
  const query = `${track.artists.join(", ")} - ${track.title}`;
  const args = [
    `ytsearch${maxResults}:${query}`,
    "--dump-json",
    "--no-download",
    "--flat-playlist",
    "--no-warnings",
    "--default-search", "ytsearch",
  ];

  let stdout: string;
  try {
    stdout = await runYtDlp(args);
  } catch {
    return [];
  }

  const candidates: YouTubeCandidate[] = [];

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      const id = json.id as string | undefined;
      const url = (json.webpage_url as string) || (id ? `https://www.youtube.com/watch?v=${id}` : "");
      if (!url) continue;

      candidates.push({
        title: (json.title as string) || "",
        artist: (json.channel as string) || (json.uploader as string) || "",
        durationSec: typeof json.duration === "number" ? json.duration : 0,
        sourceUrl: url,
      });
    } catch {
      // skip malformed json lines
    }
  }

  return candidates;
}

export function pickBestCandidate(track: SourceTrack, candidates: YouTubeCandidate[]): YouTubeCandidate | null {
  if (candidates.length === 0) return null;

  const targetSec = track.durationMs / 1000;

  let best = candidates[0];
  let bestScore = -Infinity;

  for (const c of candidates) {
    let score = 0;

    // Duration similarity (max 40 points, lose 5 per second of difference)
    const durationDiff = Math.abs(c.durationSec - targetSec);
    score += Math.max(0, 40 - durationDiff * 5);

    // Title match (max 30 points)
    const titleLower = c.title.toLowerCase();
    const trackTitle = track.title.toLowerCase();
    if (titleLower.includes(trackTitle)) score += 30;
    else {
      const words = trackTitle.split(/\s+/).filter(w => w.length > 2);
      const matched = words.filter(w => titleLower.includes(w)).length;
      score += (matched / Math.max(words.length, 1)) * 25;
    }

    // Artist match (max 20 points)
    for (const artist of track.artists) {
      if (titleLower.includes(artist.toLowerCase()) || c.artist.toLowerCase().includes(artist.toLowerCase())) {
        score += 20 / track.artists.length;
      }
    }

    // Penalize very long videos (likely compilations)
    if (c.durationSec > targetSec * 2.5) score -= 20;

    // Penalize if "live", "remix", "cover" appears when not in original
    for (const tag of ["live", "remix", "cover"]) {
      if (titleLower.includes(tag) && !trackTitle.includes(tag)) score -= 10;
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}
