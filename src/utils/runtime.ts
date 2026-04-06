import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RuntimeDependencyStatus } from "../types";

function checkCommand(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const checker = process.platform === "win32" ? "where" : "which";
    const child = spawn(checker, [command], { stdio: "ignore" });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function getRuntimeDependencyStatus(): Promise<RuntimeDependencyStatus> {
  const binDir = join(process.cwd(), "bin");
  const ytDlpAvailable = existsSync(join(binDir, "yt-dlp.exe")) || await checkCommand("yt-dlp");
  const ffmpegAvailable = existsSync(join(binDir, "ffmpeg.exe")) || await checkCommand("ffmpeg");
  return { ytDlpAvailable, ffmpegAvailable };
}
