import { spawn } from "node:child_process";
import { existsSync, accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getOptionalEnv } from "../config/env";
import { RuntimeDependencyStatus } from "../types";

const IS_WINDOWS = process.platform === "win32";

// Common install locations outside PATH (Linux / CachyOS / Arch: pacman puts
// ffmpeg in /usr/bin which is on PATH, but pip/uv/pipx installs often land in
// ~/.local/bin which may not be on PATH for every shell).
const UNIX_FALLBACK_DIRS = [
  join(homedir(), ".local", "bin"),
  "/usr/local/bin",
  "/usr/bin",
  "/opt/bin",
  join(homedir(), ".cargo", "bin"),
];

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findInFallbackDirs(command: string): string | undefined {
  if (IS_WINDOWS) return undefined;
  for (const dir of UNIX_FALLBACK_DIRS) {
    const candidate = join(dir, command);
    if (existsSync(candidate) && isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

function checkCommand(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const checker = IS_WINDOWS ? "where" : "which";
    const child = spawn(checker, [command], { stdio: "ignore" });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function hasCommand(command: string): Promise<boolean> {
  if (await checkCommand(command)) return true;
  // Not on PATH — check env overrides and common install dirs.
  const env = getOptionalEnv();
  const envPath = command === "yt-dlp" ? env.ytDlpPath : command === "ffmpeg" ? env.ffmpegPath : undefined;
  if (envPath) {
    const normalized = envPath.replace(/[\\/]$/, "");
    if (existsSync(normalized) || existsSync(join(normalized, command))) return true;
  }
  return findInFallbackDirs(command) !== undefined;
}

export async function getRuntimeDependencyStatus(): Promise<RuntimeDependencyStatus> {
  const binDir = join(process.cwd(), "bin");
  const localYtDlp =
    existsSync(join(binDir, IS_WINDOWS ? "yt-dlp.exe" : "yt-dlp")) ||
    existsSync(join(binDir, "yt-dlp.exe"));
  const localFfmpeg =
    existsSync(join(binDir, IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg")) ||
    existsSync(join(binDir, "ffmpeg.exe"));

  const ytDlpAvailable = localYtDlp || (await hasCommand("yt-dlp"));
  const ffmpegAvailable = localFfmpeg || (await hasCommand("ffmpeg"));
  return { ytDlpAvailable, ffmpegAvailable };
}
