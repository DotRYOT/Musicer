"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDownloadJob = runDownloadJob;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const env_1 = require("../config/env");
const youtube_1 = require("../api/youtube");
const IS_WINDOWS = process.platform === "win32";
function isExecutableFile(path) {
    try {
        (0, node_fs_1.accessSync)(path, node_fs_1.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
// Resolve an explicit ffmpeg binary path, or undefined if it's on PATH
// (in which case yt-dlp will find it itself and we don't pass --ffmpeg-location).
function resolveFfmpegBinary() {
    const env = (0, env_1.getOptionalEnv)();
    // FFMPEG_PATH may point at a directory (e.g. C:\ffmpeg\bin) or a binary file.
    if (env.ffmpegPath) {
        const p = env.ffmpegPath.replace(/[\\/]$/, "");
        const exeName = IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg";
        if (p.endsWith(exeName) || p.endsWith("ffmpeg"))
            return p;
        const inDir = (0, node_path_1.join)(p, exeName);
        if ((0, node_fs_1.existsSync)(inDir))
            return inDir;
        if ((0, node_fs_1.existsSync)(p))
            return p; // treat as binary path directly
    }
    // Project-local bin/ folder (bundled .exe on Windows or binary/symlink on Linux).
    const localDir = (0, node_path_1.join)(process.cwd(), "bin");
    for (const name of ["ffmpeg", "ffmpeg.exe"]) {
        const candidate = (0, node_path_1.join)(localDir, name);
        if ((0, node_fs_1.existsSync)(candidate))
            return candidate;
    }
    // Common Linux install locations that may not be on PATH.
    if (!IS_WINDOWS) {
        const searchDirs = [
            (0, node_path_1.join)((0, node_os_1.homedir)(), ".local", "bin"),
            "/usr/local/bin",
            "/usr/bin",
            "/opt/bin",
        ];
        for (const dir of searchDirs) {
            const candidate = (0, node_path_1.join)(dir, "ffmpeg");
            if ((0, node_fs_1.existsSync)(candidate) && isExecutableFile(candidate))
                return candidate;
        }
    }
    return undefined;
}
async function runDownloadJob(job) {
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
        args.push("--ffmpeg-location", (0, node_path_1.join)(ffmpegBin, ".."));
    }
    return new Promise((resolve, reject) => {
        (0, node_child_process_1.execFile)((0, youtube_1.resolveYtDlp)(), args, { timeout: 300_000, maxBuffer: 5 * 1024 * 1024 }, (err, _stdout, stderr) => {
            if (err) {
                reject(new Error(`Download failed for ${job.sourceUrl}: ${stderr || err.message}`));
                return;
            }
            resolve();
        });
    });
}
