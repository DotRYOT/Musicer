"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasCommand = hasCommand;
exports.getRuntimeDependencyStatus = getRuntimeDependencyStatus;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const env_1 = require("../config/env");
const IS_WINDOWS = process.platform === "win32";
// Common install locations outside PATH (Linux / CachyOS / Arch: pacman puts
// ffmpeg in /usr/bin which is on PATH, but pip/uv/pipx installs often land in
// ~/.local/bin which may not be on PATH for every shell).
const UNIX_FALLBACK_DIRS = [
    (0, node_path_1.join)((0, node_os_1.homedir)(), ".local", "bin"),
    "/usr/local/bin",
    "/usr/bin",
    "/opt/bin",
    (0, node_path_1.join)((0, node_os_1.homedir)(), ".cargo", "bin"),
];
function isExecutableFile(path) {
    try {
        (0, node_fs_1.accessSync)(path, node_fs_1.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function findInFallbackDirs(command) {
    if (IS_WINDOWS)
        return undefined;
    for (const dir of UNIX_FALLBACK_DIRS) {
        const candidate = (0, node_path_1.join)(dir, command);
        if ((0, node_fs_1.existsSync)(candidate) && isExecutableFile(candidate))
            return candidate;
    }
    return undefined;
}
function checkCommand(command) {
    return new Promise((resolve) => {
        const checker = IS_WINDOWS ? "where" : "which";
        const child = (0, node_child_process_1.spawn)(checker, [command], { stdio: "ignore" });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
    });
}
async function hasCommand(command) {
    if (await checkCommand(command))
        return true;
    // Not on PATH — check env overrides and common install dirs.
    const env = (0, env_1.getOptionalEnv)();
    const envPath = command === "yt-dlp" ? env.ytDlpPath : command === "ffmpeg" ? env.ffmpegPath : undefined;
    if (envPath) {
        const normalized = envPath.replace(/[\\/]$/, "");
        if ((0, node_fs_1.existsSync)(normalized) || (0, node_fs_1.existsSync)((0, node_path_1.join)(normalized, command)))
            return true;
    }
    return findInFallbackDirs(command) !== undefined;
}
async function getRuntimeDependencyStatus() {
    const binDir = (0, node_path_1.join)(process.cwd(), "bin");
    const localYtDlp = (0, node_fs_1.existsSync)((0, node_path_1.join)(binDir, IS_WINDOWS ? "yt-dlp.exe" : "yt-dlp")) ||
        (0, node_fs_1.existsSync)((0, node_path_1.join)(binDir, "yt-dlp.exe"));
    const localFfmpeg = (0, node_fs_1.existsSync)((0, node_path_1.join)(binDir, IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg")) ||
        (0, node_fs_1.existsSync)((0, node_path_1.join)(binDir, "ffmpeg.exe"));
    const ytDlpAvailable = localYtDlp || (await hasCommand("yt-dlp"));
    const ffmpegAvailable = localFfmpeg || (await hasCommand("ffmpeg"));
    return { ytDlpAvailable, ffmpegAvailable };
}
