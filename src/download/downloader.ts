import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getOptionalEnv } from "../config/env";

export interface DownloadJob {
  sourceUrl: string;
  outputPath: string;
}

function resolveYtDlp(): string {
  const env = getOptionalEnv();
  if (env.ytDlpPath) {
    const p = env.ytDlpPath.replace(/[\\/]$/, "");
    return p.endsWith("yt-dlp") || p.endsWith("yt-dlp.exe") ? p : `${p}\\yt-dlp`;
  }
  const binExe = join(process.cwd(), "bin", "yt-dlp.exe");
  if (existsSync(binExe)) return binExe;
  return "yt-dlp";
}

function resolveFfmpeg(): string | undefined {
  const env = getOptionalEnv();
  if (env.ffmpegPath) {
    return env.ffmpegPath.replace(/[\\/]$/, "");
  }
  const binDir = join(process.cwd(), "bin");
  if (existsSync(join(binDir, "ffmpeg.exe"))) return binDir;
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

  const ffmpegDir = resolveFfmpeg();
  if (ffmpegDir) {
    args.push("--ffmpeg-location", ffmpegDir);
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
