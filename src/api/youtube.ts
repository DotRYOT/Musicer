import { execFile } from "node:child_process";
import { existsSync, accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getOptionalEnv } from "../config/env";
import { SourceTrack } from "../types";

export interface YouTubeCandidate {
  title: string;
  artist: string;
  durationSec: number;
  sourceUrl: string;
}

const IS_WINDOWS = process.platform === "win32";

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Locate yt-dlp across Windows and Linux (CachyOS/Arch).
export function resolveYtDlp(): string {
  const env = getOptionalEnv();
  if (env.ytDlpPath) {
    const p = env.ytDlpPath.replace(/[\\/]$/, "");
    if (p.endsWith("yt-dlp") || p.endsWith("yt-dlp.exe")) return p;
    return join(p, IS_WINDOWS ? "yt-dlp.exe" : "yt-dlp");
  }

  // Project-local bin/ folder (supports both a bundled .exe and a Linux binary/symlink).
  const localDir = join(process.cwd(), "bin");
  for (const name of ["yt-dlp", "yt-dlp.exe"]) {
    const candidate = join(localDir, name);
    if (existsSync(candidate)) return candidate;
  }

  // Common user/system install locations that may not be on PATH.
  if (!IS_WINDOWS) {
    const searchDirs = [
      join(homedir(), ".local", "bin"),
      "/usr/local/bin",
      "/usr/bin",
      "/opt/bin",
      join(homedir(), ".cargo", "bin"),
    ];
    for (const dir of searchDirs) {
      const candidate = join(dir, "yt-dlp");
      if (existsSync(candidate) && isExecutableFile(candidate)) return candidate;
    }
  }

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
