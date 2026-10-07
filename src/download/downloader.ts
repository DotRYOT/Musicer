import { execFile } from "node:child_process";
import { existsSync, accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getOptionalEnv } from "../config/env";
import { resolveYtDlp } from "../api/youtube";

export interface DownloadJob {
  sourceUrl: string;
  outputPath: string;
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

// Resolve an explicit ffmpeg binary path, or undefined if it's on PATH
// (in which case yt-dlp will find it itself and we don't pass --ffmpeg-location).
function resolveFfmpegBinary(): string | undefined {
  const env = getOptionalEnv();

  // FFMPEG_PATH may point at a directory (e.g. C:\ffmpeg\bin) or a binary file.
  if (env.ffmpegPath) {
    const p = env.ffmpegPath.replace(/[\\/]$/, "");
    const exeName = IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg";
    if (p.endsWith(exeName) || p.endsWith("ffmpeg")) return p;
    const inDir = join(p, exeName);
    if (existsSync(inDir)) return inDir;
    if (existsSync(p)) return p; // treat as binary path directly
  }

  // Project-local bin/ folder (bundled .exe on Windows or binary/symlink on Linux).
  const localDir = join(process.cwd(), "bin");
  for (const name of ["ffmpeg", "ffmpeg.exe"]) {
    const candidate = join(localDir, name);
    if (existsSync(candidate)) return candidate;
  }

  // Common Linux install locations that may not be on PATH.
  if (!IS_WINDOWS) {
    const searchDirs = [
      join(homedir(), ".local", "bin"),
      "/usr/local/bin",
      "/usr/bin",
      "/opt/bin",
    ];
    for (const dir of searchDirs) {
      const candidate = join(dir, "ffmpeg");
      if (existsSync(candidate) && isExecutableFile(candidate)) return candidate;
    }
  }

  return undefined;
}

export async function runDownloadJob(job: DownloadJob): Promise<void> {
  const args = [
    job.sourceUrl,
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "0",
    "-o", job.outputPath,
    "--no-playlist",
    "--no-warnings",
    "--no-check-certificates",
  ];

  const ffmpegBin = resolveFfmpegBinary();
  if (ffmpegBin) {
    // yt-dlp expects the directory containing ffmpeg/ffprobe.
    args.push("--ffmpeg-location", join(ffmpegBin, ".."));
  }

  return new Promise((resolve, reject) => {
    execFile(resolveYtDlp(), args, { timeout: 300_000, maxBuffer: 5 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`Download failed for ${job.sourceUrl}: ${stderr || err.message}`));
        return;
      }
      resolve();
    });
  });
}
