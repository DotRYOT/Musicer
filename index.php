<?php

declare(strict_types=1);

/**
 * Musicer Web UI
 *
 * Browser UI for downloading TIDAL playlists as MP3 via the CLI.
 * Intended for local use only (XAMPP localhost).
 */

require_once __DIR__ . '/version.php';

$resultOutput = "";
$resultExitCode = null;
$resultCommand = "";
$errorMessage = "";
$downloadSummary = null;
$artistResults = null;

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function runCommand(string $command, string $cwd): array
{
    $descriptors = [
        0 => ["pipe", "r"],
        1 => ["pipe", "w"],
        2 => ["pipe", "w"],
    ];

    $process = proc_open($command, $descriptors, $pipes, $cwd);
    if (!is_resource($process)) {
        throw new RuntimeException("Failed to start command process.");
    }

    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);

    $exitCode = proc_close($process);

    return [
        "output" => (string) $stdout . (string) $stderr,
        "exitCode" => $exitCode,
    ];
}

// ── Setup detection ────────────────────────────────────────────────
function getSetupStatus(): array
{
    $projectDir = __DIR__;
    $checks = [];

    // 1. Node.js available
    $nodeVersion = null;
    try {
        $r = runCommand("node --version", $projectDir);
        if ($r["exitCode"] === 0 && str_starts_with(trim($r["output"]), "v")) {
            $nodeVersion = trim($r["output"]);
        }
    } catch (Throwable $e) {}
    $checks["node"] = ["ok" => $nodeVersion !== null, "detail" => $nodeVersion ?? "not found"];

    // 2. npm dependencies installed
    $hasNodeModules = is_dir($projectDir . DIRECTORY_SEPARATOR . "node_modules");
    $checks["deps"] = ["ok" => $hasNodeModules, "detail" => $hasNodeModules ? "installed" : "missing"];

    // 3. .env exists and has required values
    $envFile = $projectDir . DIRECTORY_SEPARATOR . ".env";
    $envExists = file_exists($envFile);
    $envValues = [];
    $envMissing = [];
    $requiredKeys = ["TIDAL_CLIENT_ID", "TIDAL_CLIENT_SECRET"];
    $optionalKeys = ["YT_DLP_PATH", "FFMPEG_PATH"];

    if ($envExists) {
        $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === "" || str_starts_with($line, "#")) continue;
            $eqPos = strpos($line, "=");
            if ($eqPos !== false) {
                $key = trim(substr($line, 0, $eqPos));
                $val = trim(substr($line, $eqPos + 1));
                $envValues[$key] = $val;
            }
        }
        foreach ($requiredKeys as $k) {
            if (empty($envValues[$k])) $envMissing[] = $k;
        }
    } else {
        $envMissing = $requiredKeys;
    }
    $checks["env"] = [
        "ok" => $envExists && count($envMissing) === 0,
        "detail" => !$envExists ? ".env file missing" : (count($envMissing) > 0 ? "missing: " . implode(", ", $envMissing) : "configured"),
        "exists" => $envExists,
        "values" => $envValues,
        "missing" => $envMissing,
    ];

    // 4. yt-dlp reachable
    $isWindows = strtoupper(substr(PHP_OS, 0, 3)) === 'WIN';
    $exeSuffix = $isWindows ? '.exe' : '';
    $binDir = __DIR__ . DIRECTORY_SEPARATOR . "bin";
    $ytdlpBin = $binDir . DIRECTORY_SEPARATOR . "yt-dlp" . $exeSuffix;
    $ytdlpPath = $envValues["YT_DLP_PATH"] ?? "";
    $ytdlpOk = false;
    if (file_exists($ytdlpBin)) {
        $ytdlpOk = true;
    } elseif ($ytdlpPath !== "") {
        $ytdlpExe = rtrim($ytdlpPath, "\\/") . DIRECTORY_SEPARATOR . "yt-dlp" . $exeSuffix;
        $ytdlpOk = file_exists($ytdlpExe);
        if (!$ytdlpOk) {
            $ytdlpOk = file_exists($ytdlpPath) && str_ends_with(strtolower($ytdlpPath), "yt-dlp" . $exeSuffix);
        }
    }
    if (!$ytdlpOk && !$isWindows) {
        // Fall back to PATH lookup (pacman/uv/pipx installs on CachyOS/Arch).
        $r = runCommand("command -v yt-dlp >/dev/null 2>&1 && echo found", __DIR__);
        $ytdlpOk = $r["exitCode"] === 0 && trim($r["output"]) === "found";
    }
    $checks["ytdlp"] = [
        "ok" => $ytdlpOk,
        "inBin" => file_exists($ytdlpBin),
        "detail" => $ytdlpOk ? (file_exists($ytdlpBin) ? "in bin/" : "found") : "not found",
    ];

    // 5. ffmpeg reachable
    $ffmpegBin = $binDir . DIRECTORY_SEPARATOR . "ffmpeg" . $exeSuffix;
    $ffmpegPath = $envValues["FFMPEG_PATH"] ?? "";
    $ffmpegOk = false;
    if (file_exists($ffmpegBin)) {
        $ffmpegOk = true;
    } elseif ($ffmpegPath !== "") {
        $ffmpegExe = rtrim($ffmpegPath, "\\/") . DIRECTORY_SEPARATOR . "ffmpeg" . $exeSuffix;
        $ffmpegOk = file_exists($ffmpegExe);
        if (!$ffmpegOk) {
            $ffmpegOk = file_exists($ffmpegPath) && str_ends_with(strtolower($ffmpegPath), "ffmpeg" . $exeSuffix);
        }
    }
    if (!$ffmpegOk && !$isWindows) {
        $r = runCommand("command -v ffmpeg >/dev/null 2>&1 && echo found", __DIR__);
        $ffmpegOk = $r["exitCode"] === 0 && trim($r["output"]) === "found";
    }
    $checks["ffmpeg"] = [
        "ok" => $ffmpegOk,
        "inBin" => file_exists($ffmpegBin),
        "detail" => $ffmpegOk ? (file_exists($ffmpegBin) ? "in bin/" : "found") : "not found",
    ];

    // 6. TypeScript built
    $hasDist = file_exists($projectDir . DIRECTORY_SEPARATOR . "dist" . DIRECTORY_SEPARATOR . "cli" . DIRECTORY_SEPARATOR . "index.js");
    $checks["build"] = ["ok" => $hasDist, "detail" => $hasDist ? "built" : "not built"];

    // 7. Consent accepted
    $consentFile = (getenv("USERPROFILE") ?: getenv("HOME") ?: $_SERVER["USERPROFILE"] ?? "") . DIRECTORY_SEPARATOR . ".musicer" . DIRECTORY_SEPARATOR . "consent.json";
    $consentOk = false;
    if (file_exists($consentFile)) {
        $data = json_decode(file_get_contents($consentFile), true);
        $consentOk = ($data["accepted"] ?? false) === true;
    }
    $checks["consent"] = ["ok" => $consentOk, "detail" => $consentOk ? "accepted" : "not accepted"];

    // Overall: setup needed if node, deps, env (required), build, or consent fail
    $needsSetup = !$checks["node"]["ok"] || !$checks["deps"]["ok"] || !$checks["env"]["ok"]
                  || !$checks["build"]["ok"] || !$checks["consent"]["ok"];

    return ["needsSetup" => $needsSetup, "checks" => $checks];
}

// ── Handle setup POST actions ──────────────────────────────────────
$setupMessage = "";
$setupError = "";

if ($_SERVER["REQUEST_METHOD"] === "POST" && ($_POST["action"] ?? "") === "setup_save_env") {
    $envPath = __DIR__ . DIRECTORY_SEPARATOR . ".env";
    // Read existing env to preserve tool paths if already set
    $existingEnv = [];
    if (file_exists($envPath)) {
        foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === "" || str_starts_with($line, "#")) continue;
            $eqPos = strpos($line, "=");
            if ($eqPos !== false) {
                $existingEnv[trim(substr($line, 0, $eqPos))] = trim(substr($line, $eqPos + 1));
            }
        }
    }
    $envLines = [];
    $envLines[] = "TIDAL_ACCESS_TOKEN=";
    $envLines[] = "TIDAL_CLIENT_ID=" . trim((string)($_POST["tidal_client_id"] ?? ""));
    $envLines[] = "TIDAL_CLIENT_SECRET=" . trim((string)($_POST["tidal_client_secret"] ?? ""));
    $envLines[] = "TIDAL_AUTH_BASE_URL=https://auth.tidal.com";
    $envLines[] = "TIDAL_COUNTRY_CODE=" . (trim((string)($_POST["tidal_country_code"] ?? "")) ?: "US");
    $envLines[] = "TIDAL_API_BASE_URL=https://openapi.tidal.com/v2";
    $envLines[] = "OUTPUT_DIR=./downloads";
    $envLines[] = "YT_DLP_PATH=" . ($existingEnv["YT_DLP_PATH"] ?? "");
    $envLines[] = "FFMPEG_PATH=" . ($existingEnv["FFMPEG_PATH"] ?? "");
    $envLines[] = "LOG_LEVEL=info";

    file_put_contents($envPath, implode("\n", $envLines) . "\n");
    $setupMessage = "Environment file saved.";
}

if ($_SERVER["REQUEST_METHOD"] === "POST" && ($_POST["action"] ?? "") === "setup_save_tool_paths") {
    $envPath = __DIR__ . DIRECTORY_SEPARATOR . ".env";
    $existingEnv = [];
    if (file_exists($envPath)) {
        foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $line = trim($line);
            if ($line === "" || str_starts_with($line, "#")) continue;
            $eqPos = strpos($line, "=");
            if ($eqPos !== false) {
                $existingEnv[trim(substr($line, 0, $eqPos))] = trim(substr($line, $eqPos + 1));
            }
        }
    }
    $existingEnv["YT_DLP_PATH"] = trim((string)($_POST["ytdlp_path"] ?? ""));
    $existingEnv["FFMPEG_PATH"] = trim((string)($_POST["ffmpeg_path"] ?? ""));
    $out = "";
    foreach ($existingEnv as $k => $v) {
        $out .= $k . "=" . $v . "\n";
    }
    file_put_contents($envPath, $out);
    $setupMessage = "Tool paths saved.";
}

if ($_SERVER["REQUEST_METHOD"] === "POST" && ($_POST["action"] ?? "") === "setup_install") {
    try {
        $r = runCommand("npm install 2>&1", __DIR__);
        if ($r["exitCode"] === 0) {
            $setupMessage = "Dependencies installed successfully.";
        } else {
            $setupError = "npm install failed (exit " . $r["exitCode"] . "): " . substr($r["output"], 0, 500);
        }
    } catch (Throwable $e) {
        $setupError = $e->getMessage();
    }
}

if ($_SERVER["REQUEST_METHOD"] === "POST" && ($_POST["action"] ?? "") === "setup_build") {
    try {
        $r = runCommand("npm run build 2>&1", __DIR__);
        if ($r["exitCode"] === 0) {
            $setupMessage = "Project built successfully.";
        } else {
            $setupError = "Build failed (exit " . $r["exitCode"] . "): " . substr($r["output"], 0, 500);
        }
    } catch (Throwable $e) {
        $setupError = $e->getMessage();
    }
}

if ($_SERVER["REQUEST_METHOD"] === "POST" && ($_POST["action"] ?? "") === "setup_consent") {
    try {
        $r = runCommand("npm run dev -- consent --accept 2>&1", __DIR__);
        if ($r["exitCode"] === 0) {
            $setupMessage = "Legal consent accepted.";
        } else {
            $setupError = "Consent command failed: " . substr($r["output"], 0, 500);
        }
    } catch (Throwable $e) {
        $setupError = $e->getMessage();
    }
}

if ($_SERVER["REQUEST_METHOD"] === "POST" && ($_POST["action"] ?? "") === "setup_download_ytdlp") {
    $binDir = __DIR__ . DIRECTORY_SEPARATOR . "bin";
    if (!is_dir($binDir)) {
        mkdir($binDir, 0755, true);
    }
    $isWindows = strtoupper(substr(PHP_OS, 0, 3)) === 'WIN';
    $outPath = $binDir . DIRECTORY_SEPARATOR . "yt-dlp" . ($isWindows ? ".exe" : "");
    $url = $isWindows
        ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
    try {
        $r = runCommand("curl -L --max-time 120 --retry 2 -o \"" . $outPath . "\" \"" . $url . "\" 2>&1", __DIR__);
        if ($r["exitCode"] === 0 && file_exists($outPath) && filesize($outPath) > 0) {
            if (!$isWindows) {
                @chmod($outPath, 0755);
            }
            $setupMessage = "yt-dlp downloaded successfully.";
        } else {
            $setupError = "Failed to download yt-dlp: " . substr($r["output"], 0, 500);
        }
    } catch (Throwable $e) {
        $setupError = $e->getMessage();
    }
}

if ($_SERVER["REQUEST_METHOD"] === "POST" && ($_POST["action"] ?? "") === "setup_download_ffmpeg") {
    $binDir = __DIR__ . DIRECTORY_SEPARATOR . "bin";
    if (!is_dir($binDir)) {
        mkdir($binDir, 0755, true);
    }
    $isWindows = strtoupper(substr(PHP_OS, 0, 3)) === 'WIN';

    if (!$isWindows) {
        // Linux (CachyOS/Arch): prefer the system package manager.
        $installCmd = null;
        if (str_contains(strtolower(shell_exec('cat /etc/os-release 2>/dev/null') ?: ''), 'cachyos') || PHP_OS_FAMILY === 'Linux') {
            if (@is_executable('/usr/bin/pacman') || trim((string)@shell_exec('command -v pacman')) !== '') {
                $installCmd = 'sudo pacman -S --noconfirm --needed ffmpeg';
            }
        }
        if ($installCmd === null) {
            $setupError = "Automatic FFmpeg install is not available on this system. Please install it manually (on CachyOS/Arch: sudo pacman -S ffmpeg).";
        } else {
            try {
                $r = runCommand($installCmd . " 2>&1", __DIR__);
                $verify = runCommand("command -v ffmpeg >/dev/null 2>&1 && echo found", __DIR__);
                if ($verify["exitCode"] === 0 && trim($verify["output"]) === "found") {
                    $setupMessage = "FFmpeg installed via pacman.";
                } else {
                    $setupError = "FFmpeg installation did not complete. Try manually: " . $installCmd . "\nOutput: " . substr($r["output"], 0, 600);
                }
            } catch (Throwable $e) {
                $setupError = $e->getMessage();
            }
        }
    } else {
        $tempZip     = $binDir . DIRECTORY_SEPARATOR . "ffmpeg-temp.zip";
        $tempExtract = $binDir . DIRECTORY_SEPARATOR . "ffmpeg-extract";
        $outPath     = $binDir . DIRECTORY_SEPARATOR . "ffmpeg.exe";
        $url         = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
        $psLines = [
            '$ErrorActionPreference = "Stop"',
            'Write-Host "Downloading FFmpeg..."',
            'curl.exe -L --max-time 300 --retry 2 -o "' . $tempZip . '" "' . $url . '"',
            'if ($LASTEXITCODE -ne 0) { throw "curl download failed with exit code $LASTEXITCODE" }',
            'Write-Host "Extracting..."',
            'Expand-Archive -Path "' . $tempZip . '" -DestinationPath "' . $tempExtract . '" -Force',
            '$exe = Get-ChildItem -Path "' . $tempExtract . '" -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1 -ExpandProperty FullName',
            'if (-not $exe) { throw "ffmpeg.exe not found in archive" }',
            'Copy-Item $exe -Destination "' . $outPath . '" -Force',
            'Remove-Item -Recurse -Force "' . $tempExtract . '", "' . $tempZip . '"',
            'Write-Host "Done."',
        ];
        $psScript = implode("\r\n", $psLines);
        $psFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . "musicer_ffmpeg_" . bin2hex(random_bytes(4)) . ".ps1";
        file_put_contents($psFile, $psScript);
        try {
            $r = runCommand("powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" . $psFile . "\" 2>&1", __DIR__);
            @unlink($psFile);
            if ($r["exitCode"] === 0 && file_exists($outPath) && filesize($outPath) > 0) {
                $setupMessage = "FFmpeg downloaded successfully.";
            } else {
                $setupError = "Failed to download FFmpeg: " . substr($r["output"], 0, 600);
            }
        } catch (Throwable $e) {
            @unlink($psFile);
            $setupError = $e->getMessage();
        }
    }
}

$setup = getSetupStatus();

// ── Serve individual MP3 file downloads ────────────────────────────
if (isset($_GET["serve"])) {
    $requested = $_GET["serve"];
    // Resolve relative to project downloads dir
    $downloadsBase = realpath(__DIR__ . DIRECTORY_SEPARATOR . "downloads");
    if ($downloadsBase === false) {
        http_response_code(404);
        exit("Downloads directory not found.");
    }
    $fullPath = realpath($downloadsBase . DIRECTORY_SEPARATOR . $requested);
    if (
        $fullPath === false ||
        strpos($fullPath, $downloadsBase) !== 0 ||
        !is_file($fullPath) ||
        strtolower(pathinfo($fullPath, PATHINFO_EXTENSION)) !== "mp3"
    ) {
        http_response_code(403);
        exit("Access denied.");
    }

    header("Content-Type: audio/mpeg");
    header("Content-Disposition: attachment; filename=\"" . basename($fullPath) . "\"");
    header("Content-Length: " . filesize($fullPath));
    readfile($fullPath);
    exit;
}

// ── Serve ZIP of entire playlist folder ────────────────────────────
if (isset($_GET["zip"])) {
    $requested = basename($_GET["zip"]); // folder name only
    $downloadsBase = realpath(__DIR__ . DIRECTORY_SEPARATOR . "downloads");
    if ($downloadsBase === false) {
        http_response_code(404);
        exit("Downloads directory not found.");
    }
    $folderPath = realpath($downloadsBase . DIRECTORY_SEPARATOR . $requested);
    if (
        $folderPath === false ||
        strpos($folderPath, $downloadsBase) !== 0 ||
        !is_dir($folderPath)
    ) {
        http_response_code(403);
        exit("Access denied.");
    }

    $zipName = $requested . ".zip";
    $tmpZip = tempnam(sys_get_temp_dir(), "musicer_") . ".zip";

    $zip = new ZipArchive();
    if ($zip->open($tmpZip, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        http_response_code(500);
        exit("Could not create zip archive.");
    }
    $files = glob($folderPath . DIRECTORY_SEPARATOR . "*.mp3");
    foreach ($files as $f) {
        $zip->addFile($f, basename($f));
    }
    $zip->close();

    header("Content-Type: application/zip");
    header("Content-Disposition: attachment; filename=\"" . $zipName . "\"");
    header("Content-Length: " . filesize($tmpZip));
    readfile($tmpZip);
    unlink($tmpZip);
    exit;
}

// ── Polling-based progress: start job ──────────────────────────────
if ($_SERVER["REQUEST_METHOD"] === "POST" && isset($_SERVER["HTTP_X_STREAM"]) && !$setup["needsSetup"]) {
    $action = $_POST["action"] ?? "";
    $input = trim((string) ($_POST["input"] ?? ""));

    if ($input === "" || !in_array($action, ["download", "album"], true)) {
        header("Content-Type: application/json");
        echo json_encode(["error" => "Invalid request."]);
        exit;
    }

    // Create a unique job ID and temp files
    $jobId = bin2hex(random_bytes(8));
    $tmpDir = sys_get_temp_dir();
    $outFile = $tmpDir . DIRECTORY_SEPARATOR . "musicer_job_" . $jobId . ".log";

    // Touch output file so polling can start
    file_put_contents($outFile, "");

    // Build a temporary batch file to run the command in background
    $nodeCmd = 'node dist\\cli\\index.js ' . $action . ' ' . escapeshellarg($input);
    $batFile = $tmpDir . DIRECTORY_SEPARATOR . "musicer_job_" . $jobId . ".bat";
    $batContent  = "@echo off\r\n";
    $batContent .= 'cd /d "' . __DIR__ . '"' . "\r\n";
    $batContent .= $nodeCmd . ' > "' . $outFile . '" 2>&1' . "\r\n";
    $batContent .= 'if %ERRORLEVEL% == 0 (echo __DONE_0__ >> "' . $outFile . '") else (echo __DONE_1__ >> "' . $outFile . '")' . "\r\n";
    $batContent .= 'del "' . $batFile . '"' . "\r\n";
    file_put_contents($batFile, $batContent);

    // start /b "" "file" — empty quotes for window title
    pclose(popen('start /b "" "' . $batFile . '"', 'r'));

    header("Content-Type: application/json");
    echo json_encode(["jobId" => $jobId]);
    exit;
}

// ── Polling-based progress: poll for events ────────────────────────
if ($_SERVER["REQUEST_METHOD"] === "GET" && isset($_GET["poll"]) && !$setup["needsSetup"]) {
    $jobId = preg_replace('/[^a-f0-9]/', '', $_GET["poll"]);
    $cursor = max(0, (int) ($_GET["cursor"] ?? 0));

    $tmpDir = sys_get_temp_dir();
    $outFile = $tmpDir . DIRECTORY_SEPARATOR . "musicer_job_" . $jobId . ".log";

    if (!file_exists($outFile)) {
        header("Content-Type: application/json");
        echo json_encode(["events" => [], "cursor" => 0, "done" => true, "error" => "Job not found"]);
        exit;
    }

    $content = file_get_contents($outFile);
    $newContent = substr($content, $cursor);
    $newCursor = strlen($content);

    $events = [];
    $isDone = false;
    $exitCode = 0;

    if ($newContent !== "" && $newContent !== false) {
        // Check for done marker
        if (preg_match('/__DONE_(\d+)__/', $newContent, $dm)) {
            $isDone = true;
            $exitCode = (int) $dm[1];
            $newContent = str_replace($dm[0], '', $newContent);
        }

        // Extract progress markers
        while (preg_match('/__PROGRESS__(.+?)__END_PROGRESS__/', $newContent, $m)) {
            $data = json_decode($m[1], true);
            if ($data) $events[] = ["type" => "progress", "data" => $data];
            $newContent = str_replace($m[0], '', $newContent);
        }

        // Extract summary markers
        while (preg_match('/__JSON_SUMMARY__(.+?)__END_JSON__/', $newContent, $m)) {
            $data = json_decode($m[1], true);
            if ($data) $events[] = ["type" => "summary", "data" => $data];
            $newContent = str_replace($m[0], '', $newContent);
        }

        // Remaining non-empty text as log lines
        $remaining = trim($newContent);
        if ($remaining !== "") {
            foreach (explode("\n", $remaining) as $line) {
                $line = trim($line);
                if ($line !== "") $events[] = ["type" => "log", "data" => $line];
            }
        }
    }

    if ($isDone) {
        $events[] = ["type" => "done", "data" => ["exitCode" => $exitCode]];
        // Clean up temp file after a short delay (client will get this response)
        @unlink($outFile);
    }

    header("Content-Type: application/json");
    header("Cache-Control: no-cache");
    echo json_encode(["events" => $events, "cursor" => $newCursor, "done" => $isDone]);
    exit;
}

// ── Handle POST actions (only when setup is complete) ──────────────
if ($_SERVER["REQUEST_METHOD"] === "POST" && !$setup["needsSetup"]) {
    $action = $_POST["action"] ?? "";
    $playlist = trim((string) ($_POST["playlist"] ?? ""));
    $albumInput = trim((string) ($_POST["album"] ?? ""));
    $artistQuery = trim((string) ($_POST["artist_query"] ?? ""));

    $command = "";

    try {
        switch ($action) {
            case "check":
                $command = "npm run dev -- check";
                break;

            case "consent_accept":
                $command = "npm run dev -- consent --accept";
                break;

            case "auth_login":
                $command = "npm run dev -- auth login";
                break;

            case "download":
                if ($playlist === "") {
                    throw new InvalidArgumentException("Playlist URL or ID is required.");
                }
                set_time_limit(0);
                $command = "npm run dev -- download " . escapeshellarg($playlist);
                break;

            case "album":
                if ($albumInput === "") {
                    throw new InvalidArgumentException("Album URL or ID is required.");
                }
                set_time_limit(0);
                $command = "npm run dev -- album " . escapeshellarg($albumInput);
                break;

            case "artist_search":
                if ($artistQuery === "") {
                    throw new InvalidArgumentException("Artist name is required.");
                }
                set_time_limit(0);
                $command = "npm run dev -- artist " . escapeshellarg($artistQuery);
                break;

            default:
                throw new InvalidArgumentException("Unsupported action.");
        }

        $result = runCommand($command, __DIR__);
        $resultOutput = $result["output"];
        $resultExitCode = $result["exitCode"];
        $resultCommand = $command;

        // Extract JSON summary from download output
        if (($action === "download" || $action === "album") && preg_match('/__JSON_SUMMARY__(.+?)__END_JSON__/', $resultOutput, $m)) {
            $downloadSummary = json_decode($m[1], true);
            $resultOutput = preg_replace('/__JSON_SUMMARY__.+?__END_JSON__/', '', $resultOutput);
        }

        // Extract artist search results
        if ($action === "artist_search" && preg_match('/__JSON_ARTIST_SEARCH__(.+?)__END_JSON__/', $resultOutput, $m)) {
            $artistResults = json_decode($m[1], true);
            $resultOutput = preg_replace('/__JSON_ARTIST_SEARCH__.+?__END_JSON__/', '', $resultOutput);
        }
    } catch (Throwable $t) {
        $errorMessage = $t->getMessage();
    }
}

// ── Gather existing downloaded playlists for browsing ──────────────
$existingPlaylists = [];
$downloadsDir = __DIR__ . DIRECTORY_SEPARATOR . "downloads";
if (is_dir($downloadsDir)) {
    foreach (scandir($downloadsDir) as $entry) {
        if ($entry === "." || $entry === "..") continue;
        $full = $downloadsDir . DIRECTORY_SEPARATOR . $entry;
        if (!is_dir($full)) continue;
        $mp3s = glob($full . DIRECTORY_SEPARATOR . "*.mp3");
        if (count($mp3s) > 0) {
            $existingPlaylists[] = [
                "name" => $entry,
                "count" => count($mp3s),
                "files" => array_map("basename", $mp3s),
                "mtime" => filemtime($full),
            ];
        }
    }
    // Sort newest first
    usort($existingPlaylists, function($a, $b) { return $b["mtime"] - $a["mtime"]; });
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <title>Musicer</title>
  <script>
    // Apply theme before paint to prevent flash
    (function(){var t=localStorage.getItem('musicer-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');else if(t==='light')document.documentElement.setAttribute('data-theme','light');})();
  </script>
  <style>
    :root {
      --bg: #f5efe3;
      --panel: #fffaf2;
      --ink: #222222;
      --muted: #5b5b5b;
      --accent: #016a70;
      --accent-strong: #044b50;
      --danger: #a91d3a;
      --ok: #0f8b4c;
      --border: #d8cfc2;
      --input-bg: #fff;
      --hero-from: #016a70;
      --hero-to: #4f8a8b;
      --result-bg: #121212;
      --result-border: #2f2f2f;
      --result-text: #d3f3d5;
      --result-meta: #c5ebff;
      --error-bg: #fff1f4;
      --error-border: #e0a8b2;
      --stat-ok-bg: #e8f5e9;
      --stat-warn-bg: #fff3cd;
      --stat-err-bg: #fce4ec;
      --body-grad-1: #fff7e8;
      --body-grad-2: #f5efe3;
      --body-grad-3: #efe7da;
      --body-grad-4: #f8f3ea;
    }

    [data-theme="dark"] {
      --bg: #1a1a2e;
      --panel: #16213e;
      --ink: #e0e0e0;
      --muted: #9e9e9e;
      --accent: #0f9b8e;
      --accent-strong: #14c4b2;
      --danger: #ef5350;
      --ok: #66bb6a;
      --border: #2a2a4a;
      --input-bg: #1e1e3a;
      --hero-from: #0d7377;
      --hero-to: #1a3a5c;
      --result-bg: #0d0d1a;
      --result-border: #2a2a4a;
      --result-text: #a5d6a7;
      --result-meta: #90caf9;
      --error-bg: #2c1215;
      --error-border: #5c2028;
      --stat-ok-bg: #1b3a1e;
      --stat-warn-bg: #3a3520;
      --stat-err-bg: #3a1a1e;
      --body-grad-1: #1a1a2e;
      --body-grad-2: #1a1a2e;
      --body-grad-3: #16213e;
      --body-grad-4: #16213e;
    }

    @media (prefers-color-scheme: dark) {
      :root:not([data-theme="light"]) {
        --bg: #1a1a2e;
        --panel: #16213e;
        --ink: #e0e0e0;
        --muted: #9e9e9e;
        --accent: #0f9b8e;
        --accent-strong: #14c4b2;
        --danger: #ef5350;
        --ok: #66bb6a;
        --border: #2a2a4a;
        --input-bg: #1e1e3a;
        --hero-from: #0d7377;
        --hero-to: #1a3a5c;
        --result-bg: #0d0d1a;
        --result-border: #2a2a4a;
        --result-text: #a5d6a7;
        --result-meta: #90caf9;
        --error-bg: #2c1215;
        --error-border: #5c2028;
        --stat-ok-bg: #1b3a1e;
        --stat-warn-bg: #3a3520;
        --stat-err-bg: #3a1a1e;
        --body-grad-1: #1a1a2e;
        --body-grad-2: #1a1a2e;
        --body-grad-3: #16213e;
        --body-grad-4: #16213e;
      }
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 10% 20%, var(--body-grad-1) 0%, var(--body-grad-2) 50%),
        linear-gradient(135deg, var(--body-grad-3) 0%, var(--body-grad-4) 100%);
      min-height: 100vh;
      transition: background .3s ease, color .3s ease;
    }

    .wrap { max-width: 1080px; margin: 0 auto; padding: 24px; }

    .hero {
      background: linear-gradient(120deg, var(--hero-from) 0%, var(--hero-to) 100%);
      border-radius: 16px; padding: 24px; color: #ffffff;
      box-shadow: 0 12px 28px rgba(0,0,0,0.15);
      position: relative;
    }
    .hero h1 { margin: 0 0 10px 0; letter-spacing: .4px; }
    .hero p { margin: 0; line-height: 1.5; max-width: 760px; }

    .grid {
      margin-top: 20px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
    }

    .card {
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 14px; padding: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
    .card h2 { margin: 0 0 10px 0; font-size: 1.05rem; }

    label { display: block; font-size: .95rem; margin-bottom: 6px; color: var(--muted); }
    input, select {
      width: 100%; padding: 10px; border-radius: 8px;
      border: 1px solid var(--border); font-size: .95rem;
      background: var(--input-bg); color: var(--ink); margin-bottom: 10px;
      transition: background .3s ease, color .3s ease, border-color .3s ease;
    }
    button {
      border: 0; border-radius: 10px; background: var(--accent);
      color: #fff; padding: 10px 14px; cursor: pointer; font-weight: 600;
      transition: transform 120ms ease, background 120ms ease;
    }
    button:hover { background: var(--accent-strong); transform: translateY(-1px); }
    .btn-sm { padding: 6px 12px; font-size: .85rem; border-radius: 8px; }
    .btn-zip { background: #6b4c9a; }
    .btn-zip:hover { background: #503a78; }

    .result {
      margin-top: 20px; background: var(--result-bg); color: var(--result-text);
      border-radius: 12px; border: 1px solid var(--result-border); padding: 14px;
    }
    .result pre {
      white-space: pre-wrap; word-break: break-word;
      margin: 0; font-size: .9rem; line-height: 1.45;
    }
    .meta { margin-bottom: 10px; color: var(--result-meta); font-size: .88rem; }

    .error {
      margin-top: 18px; padding: 12px; border-radius: 10px;
      border: 1px solid var(--error-border); background: var(--error-bg); color: var(--danger);
    }
    .status-ok { color: var(--ok); }
    .status-bad { color: var(--danger); }

    .library { margin-top: 24px; }
    .library h2 { margin: 0 0 14px 0; }
    .playlist-card {
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 14px; padding: 14px; margin-bottom: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
    .playlist-card h3 { margin: 0 0 8px 0; font-size: 1rem; }
    .track-list { list-style: none; padding: 0; margin: 8px 0; }
    .track-list li {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 0; border-bottom: 1px solid var(--border); font-size: .9rem;
    }
    .track-list li:last-child { border-bottom: none; }
    .track-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 10px; }
    .dl-link { color: var(--accent); text-decoration: none; font-weight: 600; white-space: nowrap; }
    .dl-link:hover { text-decoration: underline; }

    .summary-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px; margin: 14px 0;
    }
    .summary-stat {
      text-align: center; padding: 10px; border-radius: 10px;
      background: var(--stat-ok-bg); font-weight: 700; font-size: 1.1rem;
    }
    .summary-stat small { display: block; font-weight: 400; font-size: .8rem; color: var(--muted); }
    .stat-warn { background: var(--stat-warn-bg); }
    .stat-err { background: var(--stat-err-bg); }

    .footnote { margin-top: 16px; color: var(--muted); font-size: .86rem; }
    .version-row { display:flex; align-items:center; gap:10px; margin-top:6px; }
    .version-tag { font-size:.78rem; color:var(--muted); background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:2px 8px; }
    .version-link { font-size:.78rem; color:var(--accent); text-decoration:none; }
    .version-link:hover { text-decoration:underline; }
    .loading { display: none; } form.submitting .loading { display: inline; }
    form.submitting button[type=submit] { opacity: .6; pointer-events: none; }

    .card, .playlist-card { transition: background .3s ease, border-color .3s ease; }

    .artist-result { margin-top: 20px; }
    .artist-result h2 { margin: 0 0 14px 0; }
    .artist-card {
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 14px; padding: 14px; margin-bottom: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
    .artist-card h3 { margin: 0 0 10px 0; font-size: 1.05rem; }
    .album-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 10px; margin-top: 8px;
    }
    .album-item {
      background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
      padding: 10px; display: flex; flex-direction: column; gap: 6px;
      transition: background .3s ease;
    }
    .album-item .album-title { font-weight: 600; font-size: .92rem; }
    .album-item .album-meta { font-size: .8rem; color: var(--muted); }
    .btn-dl-album {
      display: inline-block; padding: 5px 12px; font-size: .82rem;
      border-radius: 8px; background: var(--accent); color: #fff;
      text-decoration: none; font-weight: 600; border: 0; cursor: pointer;
      transition: background 120ms ease;
    }
    .btn-dl-album:hover { background: var(--accent-strong); }

    /* ── Theme Toggle ── */
    .theme-toggle {
      position: absolute; top: 14px; right: 14px;
      display: flex; gap: 4px; background: rgba(0,0,0,.25);
      border-radius: 10px; padding: 3px;
    }
    .theme-toggle button {
      background: transparent; color: rgba(255,255,255,.6);
      padding: 5px 10px; font-size: .78rem; border-radius: 8px;
      font-weight: 500; transition: background .2s, color .2s;
    }
    .theme-toggle button:hover { background: rgba(255,255,255,.12); color: #fff; transform: none; }
    .theme-toggle button.active { background: rgba(255,255,255,.22); color: #fff; }

    /* ── Setup Wizard ── */
    .setup-hero h1 { margin: 0 0 6px 0; }
    .setup-hero p { margin: 0; opacity: .9; }
    .setup-steps { margin-top: 20px; display: flex; flex-direction: column; gap: 14px; }
    .setup-step {
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 14px; padding: 16px 18px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
      transition: background .3s ease, border-color .3s ease;
    }
    .setup-step h2 {
      margin: 0 0 6px 0; font-size: 1.05rem;
      display: flex; align-items: center; gap: 8px;
    }
    .setup-step p { margin: 4px 0 10px 0; font-size: .9rem; color: var(--muted); line-height: 1.5; }
    .step-badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 50%;
      font-size: .75rem; font-weight: 700; flex-shrink: 0;
    }
    .badge-ok { background: var(--ok); color: #fff; }
    .badge-pending { background: var(--border); color: var(--muted); }
    .badge-err { background: var(--danger); color: #fff; }
    .setup-msg {
      margin-bottom: 14px; padding: 10px 14px; border-radius: 10px;
      font-size: .92rem; font-weight: 500;
    }
    .setup-msg-ok { background: var(--stat-ok-bg); color: var(--ok); border: 1px solid var(--ok); }
    .setup-msg-err { background: var(--error-bg); color: var(--danger); border: 1px solid var(--error-border); }
    .setup-step .field-row { margin-bottom: 8px; }
    .setup-step .field-row label { font-size: .88rem; margin-bottom: 4px; }
    .setup-step code {
      background: var(--input-bg); padding: 2px 6px; border-radius: 4px;
      font-size: .88rem; border: 1px solid var(--border);
    }
    .setup-step .hint { font-size: .82rem; color: var(--muted); margin: 2px 0 0 0; }
    .ready-banner {
      margin-top: 20px; padding: 16px; border-radius: 14px; text-align: center;
      background: var(--stat-ok-bg); border: 1px solid var(--ok);
    }
    .ready-banner h2 { margin: 0 0 6px 0; color: var(--ok); }
    .ready-banner p { margin: 0 0 12px 0; color: var(--muted); font-size: .92rem; }

    /* ── Progress Modal ── */
    .progress-overlay {
      display: none; position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,.55); backdrop-filter: blur(4px);
      align-items: center; justify-content: center;
    }
    .progress-overlay.active { display: flex; }
    .progress-modal {
      background: var(--panel); border: 1px solid var(--border);
      border-radius: 18px; padding: 24px; width: 94%; max-width: 640px;
      max-height: 85vh; display: flex; flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,.3);
    }
    .progress-header { margin: 0 0 4px 0; font-size: 1.15rem; }
    .progress-sub { color: var(--muted); font-size: .88rem; margin: 0 0 14px 0; }
    .progress-bar-wrap {
      background: var(--border); border-radius: 8px; height: 10px;
      overflow: hidden; margin-bottom: 6px;
    }
    .progress-bar {
      height: 100%; background: var(--accent); border-radius: 8px;
      width: 0%; transition: width .3s ease;
    }
    .progress-pct { font-size: .82rem; color: var(--muted); margin: 0 0 14px 0; text-align: right; }
    .progress-current {
      padding: 10px 14px; border-radius: 10px; margin-bottom: 12px;
      background: var(--input-bg); border: 1px solid var(--border);
      font-size: .92rem; min-height: 42px;
      display: flex; align-items: center; gap: 10px;
    }
    .progress-current .spinner {
      width: 16px; height: 16px; border: 2px solid var(--border);
      border-top-color: var(--accent); border-radius: 50%;
      animation: spin .7s linear infinite; flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .progress-tracks {
      flex: 1; overflow-y: auto; margin-bottom: 12px;
      max-height: 300px; border: 1px solid var(--border); border-radius: 10px;
    }
    .progress-tracks ul { list-style: none; padding: 0; margin: 0; }
    .progress-tracks li {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 12px; font-size: .88rem; border-bottom: 1px solid var(--border);
    }
    .progress-tracks li:last-child { border-bottom: none; }
    .progress-tracks .t-icon { width: 18px; text-align: center; flex-shrink: 0; font-size: .85rem; }
    .progress-tracks .t-icon.ok { color: var(--ok); }
    .progress-tracks .t-icon.fail { color: var(--danger); }
    .progress-tracks .t-icon.skip { color: var(--muted); }
    .progress-tracks .t-icon.wait { color: var(--border); }
    .progress-tracks .t-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .progress-tracks .t-status { font-size: .8rem; color: var(--muted); flex-shrink: 0; }
    .progress-log {
      margin-top: auto;
    }
    .progress-log summary {
      cursor: pointer; font-size: .84rem; color: var(--muted);
      user-select: none; padding: 4px 0;
    }
    .progress-log pre {
      background: var(--result-bg); color: var(--result-text); padding: 10px;
      border-radius: 8px; max-height: 160px; overflow-y: auto;
      font-size: .82rem; white-space: pre-wrap; word-break: break-word;
      margin: 6px 0 0 0;
    }
    .progress-actions { margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end; }
    .progress-actions button { min-width: 100px; }
    .progress-actions .btn-muted { background: var(--border); color: var(--ink); }
    .progress-actions .btn-muted:hover { background: var(--muted); color: #fff; }
  </style>
</head>
<body>
  <main class="wrap">
<?php if ($setup["needsSetup"]): ?>
    <?php $ch = $setup["checks"]; ?>
    <section class="hero setup-hero">
      <h1>Musicer &mdash; Setup</h1>
      <p>Welcome! Let's get everything configured so you can start downloading music.</p>
      <div class="theme-toggle" id="themeToggle">
        <button data-theme="auto" title="Auto (system)">Auto</button>
        <button data-theme="light" title="Light mode">Light</button>
        <button data-theme="dark" title="Dark mode">Dark</button>
      </div>
    </section>

    <?php if ($setupMessage): ?>
      <div class="setup-msg setup-msg-ok"><?php echo h($setupMessage); ?></div>
    <?php endif; ?>
    <?php if ($setupError): ?>
      <div class="setup-msg setup-msg-err"><?php echo h($setupError); ?></div>
    <?php endif; ?>

    <section class="setup-steps">
      <!-- Step 1: Node.js -->
      <div class="setup-step">
        <h2>
          <span class="step-badge <?php echo $ch['node']['ok'] ? 'badge-ok' : 'badge-err'; ?>"><?php echo $ch['node']['ok'] ? '✓' : '1'; ?></span>
          Node.js
        </h2>
        <?php if ($ch["node"]["ok"]): ?>
          <p>Node.js <strong><?php echo h($ch["node"]["detail"]); ?></strong> detected.</p>
        <?php else: ?>
          <p>
            Node.js is required but was not found. Install it from
            <a href="https://nodejs.org/" target="_blank" rel="noopener" style="color:var(--accent)">nodejs.org</a>
            (v18 or later recommended), then refresh this page.
          </p>
        <?php endif; ?>
      </div>

      <!-- Step 2: Install dependencies -->
      <div class="setup-step">
        <h2>
          <span class="step-badge <?php echo $ch['deps']['ok'] ? 'badge-ok' : 'badge-pending'; ?>"><?php echo $ch['deps']['ok'] ? '✓' : '2'; ?></span>
          Install Dependencies
        </h2>
        <?php if ($ch["deps"]["ok"]): ?>
          <p>npm packages are installed.</p>
        <?php else: ?>
          <p>npm packages need to be installed. Click below to run <code>npm install</code>.</p>
          <form method="post">
            <input type="hidden" name="action" value="setup_install">
            <button type="submit" <?php echo !$ch["node"]["ok"] ? 'disabled style="opacity:.5"' : ''; ?>>Install Dependencies</button>
          </form>
        <?php endif; ?>
      </div>

      <!-- Step 3: Configure .env -->
      <div class="setup-step">
        <h2>
          <span class="step-badge <?php echo $ch['env']['ok'] ? 'badge-ok' : 'badge-pending'; ?>"><?php echo $ch['env']['ok'] ? '✓' : '3'; ?></span>
          Configuration
        </h2>
        <?php if ($ch["env"]["ok"]): ?>
          <p>TIDAL credentials are configured.</p>
        <?php else: ?>
          <p>
            Enter your TIDAL API credentials. You'll need a free
            <a href="https://developer.tidal.com/" target="_blank" rel="noopener" style="color:var(--accent)">TIDAL Developer</a>
            account to get them.
          </p>
          <?php $ev = $ch["env"]["values"] ?? []; ?>
          <form method="post">
            <input type="hidden" name="action" value="setup_save_env">
            <div class="field-row">
              <label for="s_tid">TIDAL Client ID <span style="color:var(--danger)">*</span></label>
              <input id="s_tid" name="tidal_client_id" value="<?php echo h($ev['TIDAL_CLIENT_ID'] ?? ''); ?>" placeholder="Your TIDAL Client ID">
            </div>
            <div class="field-row">
              <label for="s_tsec">TIDAL Client Secret <span style="color:var(--danger)">*</span></label>
              <input id="s_tsec" name="tidal_client_secret" type="password" value="<?php echo h($ev['TIDAL_CLIENT_SECRET'] ?? ''); ?>" placeholder="Your TIDAL Client Secret">
            </div>
            <div class="field-row">
              <label for="s_cc">Country Code</label>
              <input id="s_cc" name="tidal_country_code" value="<?php echo h($ev['TIDAL_COUNTRY_CODE'] ?? 'US'); ?>" placeholder="US" style="max-width:120px">
              <p class="hint">Two-letter country code for TIDAL catalog (default: US)</p>
            </div>
            <button type="submit">Save Configuration</button>
          </form>
        <?php endif; ?>
      </div>

      <!-- Step 4: Tools -->
      <div class="setup-step">
        <h2>
          <span class="step-badge <?php echo ($ch['ytdlp']['ok'] && $ch['ffmpeg']['ok']) ? 'badge-ok' : 'badge-pending'; ?>"><?php echo ($ch['ytdlp']['ok'] && $ch['ffmpeg']['ok']) ? '✓' : '4'; ?></span>
          Download Tools
        </h2>
        <p>yt-dlp and FFmpeg are required to search YouTube and convert audio to MP3.</p>

        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:14px">
          <!-- yt-dlp row -->
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <div style="min-width:180px">
              <strong>yt-dlp</strong>
              <?php if ($ch["ytdlp"]["ok"]): ?>
                &nbsp;<span style="color:var(--success);font-size:.9rem">✓ <?php echo h($ch["ytdlp"]["detail"]); ?></span>
              <?php else: ?>
                &nbsp;<span style="color:var(--danger);font-size:.9rem">✗ not found</span>
              <?php endif; ?>
            </div>
            <?php if (!$ch["ytdlp"]["inBin"]): ?>
              <form method="post" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Downloading…'">
                <input type="hidden" name="action" value="setup_download_ytdlp">
                <button type="submit">Download yt-dlp <small style="opacity:.7">(~20 MB)</small></button>
              </form>
            <?php endif; ?>
          </div>

          <!-- ffmpeg row -->
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <div style="min-width:180px">
              <strong>FFmpeg</strong>
              <?php if ($ch["ffmpeg"]["ok"]): ?>
                &nbsp;<span style="color:var(--success);font-size:.9rem">✓ <?php echo h($ch["ffmpeg"]["detail"]); ?></span>
              <?php else: ?>
                &nbsp;<span style="color:var(--danger);font-size:.9rem">✗ not found</span>
              <?php endif; ?>
            </div>
            <?php if (!$ch["ffmpeg"]["inBin"]): ?>
              <form method="post" style="margin:0" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Downloading… (may take a minute)'">
                <input type="hidden" name="action" value="setup_download_ffmpeg">
                <button type="submit">Download FFmpeg <small style="opacity:.7">(~80 MB)</small></button>
              </form>
            <?php endif; ?>
          </div>
        </div>

        <details style="margin-top:6px">
          <summary style="cursor:pointer;font-size:.88rem;color:var(--muted);user-select:none">Advanced: use tools already installed elsewhere</summary>
          <div style="margin-top:10px">
            <p class="hint" style="margin-bottom:10px">
              If you already have yt-dlp and FFmpeg installed, enter their paths here instead.
              Leave blank to use the downloaded copies in <code>bin/</code>.
            </p>
            <?php $ev2 = $ch["env"]["values"] ?? []; ?>
            <form method="post">
              <input type="hidden" name="action" value="setup_save_tool_paths">
              <div class="field-row">
                <label for="s_yt">yt-dlp Path</label>
                <input id="s_yt" name="ytdlp_path" value="<?php echo h($ev2['YT_DLP_PATH'] ?? ''); ?>" placeholder="C:\ytdlp\  (leave blank to use bin/)">
              </div>
              <div class="field-row">
                <label for="s_ff">FFmpeg Path</label>
                <input id="s_ff" name="ffmpeg_path" value="<?php echo h($ev2['FFMPEG_PATH'] ?? ''); ?>" placeholder="C:\ffmpeg\bin\  (leave blank to use bin/)">
              </div>
              <button type="submit">Save Custom Paths</button>
            </form>
          </div>
        </details>
      </div>

      <!-- Step 5: Build -->
      <div class="setup-step">
        <h2>
          <span class="step-badge <?php echo $ch['build']['ok'] ? 'badge-ok' : 'badge-pending'; ?>"><?php echo $ch['build']['ok'] ? '✓' : '5'; ?></span>
          Build Project
        </h2>
        <?php if ($ch["build"]["ok"]): ?>
          <p>TypeScript is compiled and ready.</p>
        <?php else: ?>
          <p>The project needs to be compiled before first use.</p>
          <form method="post">
            <input type="hidden" name="action" value="setup_build">
            <button type="submit" <?php echo (!$ch["node"]["ok"] || !$ch["deps"]["ok"]) ? 'disabled style="opacity:.5"' : ''; ?>>Build Project</button>
          </form>
        <?php endif; ?>
      </div>

      <!-- Step 6: Legal consent -->
      <div class="setup-step">
        <h2>
          <span class="step-badge <?php echo $ch['consent']['ok'] ? 'badge-ok' : 'badge-pending'; ?>"><?php echo $ch['consent']['ok'] ? '✓' : '6'; ?></span>
          Legal Consent
        </h2>
        <?php if ($ch["consent"]["ok"]): ?>
          <p>Consent has been accepted.</p>
        <?php else: ?>
          <p style="line-height:1.6">
            <strong>Warning:</strong> This tool is for personal use only. Downloading content may violate
            platform Terms of Service and local laws. You are solely responsible for how you use this software.
          </p>
          <form method="post">
            <input type="hidden" name="action" value="setup_consent">
            <button type="submit" <?php echo !$ch["build"]["ok"] ? 'disabled style="opacity:.5"' : ''; ?>>I Understand &amp; Accept</button>
          </form>
        <?php endif; ?>
      </div>
    </section>

    <?php
      $allDone = $ch["node"]["ok"] && $ch["deps"]["ok"] && $ch["env"]["ok"] && $ch["build"]["ok"] && $ch["consent"]["ok"];
      $toolsWarning = !$ch["ytdlp"]["ok"] || !$ch["ffmpeg"]["ok"];
    ?>
    <?php if ($allDone): ?>
      <div class="ready-banner">
        <h2>Setup Complete!</h2>
        <?php if ($toolsWarning): ?>
          <p>yt-dlp or FFmpeg not found &mdash; use the <strong>Download Tools</strong> step above before downloading music.</p>
        <?php else: ?>
          <p>Everything looks good. Refresh the page to start using Musicer.</p>
        <?php endif; ?>
        <a href="?" style="display:inline-block;padding:10px 20px;background:var(--accent);color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Go to Musicer &rarr;</a>
      </div>
    <?php endif; ?>

    <p class="footnote">
      Security: this page runs local commands. Do not expose publicly.
    </p>
  </main>
<?php else: ?>
  <!-- ═══════════════ MAIN APP UI ═══════════════ -->
    <section class="hero">
      <h1>Musicer</h1>
      <p>Download TIDAL playlists as tagged MP3 files. Paste a playlist link, hit download, then grab your files below.</p>
      <div class="version-row"><span class="version-tag">v<?php echo htmlspecialchars($version); ?></span> <a href="update.php" class="version-link">Check for Updates</a></div>
      <div class="theme-toggle" id="themeToggle">
        <button data-theme="auto" title="Auto (system)">Auto</button>
        <button data-theme="light" title="Light mode">Light</button>
        <button data-theme="dark" title="Dark mode">Dark</button>
      </div>
    </section>

    <!-- ── Action Cards ──────────────────────────────────────── -->
    <section class="grid">
      <form method="post" class="card">
        <h2>Environment Check</h2>
        <input type="hidden" name="action" value="check">
        <button type="submit">Run Check</button>
      </form>

      <form method="post" class="card">
        <h2>Accept Consent</h2>
        <input type="hidden" name="action" value="consent_accept">
        <button type="submit">Accept Legal Consent</button>
      </form>

      <form method="post" class="card">
        <h2>Auth Status</h2>
        <input type="hidden" name="action" value="auth_login">
        <button type="submit">Check TIDAL Auth</button>
      </form>

      <form id="form-download" method="post" class="card" style="grid-column: 1 / -1;">
        <h2>Download Playlist</h2>
        <label for="playlist">TIDAL Playlist URL or ID</label>
        <input id="playlist" name="playlist" placeholder="https://tidal.com/browse/playlist/..." value="<?php echo h($_POST['playlist'] ?? ''); ?>">
        <input type="hidden" name="action" value="download">
        <button type="submit">Download</button>
        <p style="margin:6px 0 0;font-size:.82rem;color:var(--muted)">This can take several minutes for large playlists.</p>
      </form>

      <form id="form-album" method="post" class="card" style="grid-column: 1 / -1;">
        <h2>Download Album</h2>
        <label for="album">TIDAL Album URL or ID</label>
        <input id="album" name="album" placeholder="https://tidal.com/browse/album/..." value="<?php echo h($_POST['album'] ?? ''); ?>">
        <input type="hidden" name="action" value="album">
        <button type="submit">Download Album</button>
        <p style="margin:6px 0 0;font-size:.82rem;color:var(--muted)">Downloads all tracks from the album.</p>
      </form>

      <form method="post" class="card" style="grid-column: 1 / -1;" onsubmit="this.classList.add('submitting')">
        <h2>Search Artist</h2>
        <label for="artist_query">Artist Name</label>
        <input id="artist_query" name="artist_query" placeholder="e.g. Queen, Kendrick Lamar..." value="<?php echo h($_POST['artist_query'] ?? ''); ?>">
        <input type="hidden" name="action" value="artist_search">
        <button type="submit">Search <span class="loading">&#8987; Searching...</span></button>
        <p style="margin:6px 0 0;font-size:.82rem;color:var(--muted)">Find an artist and browse their albums to download.</p>
      </form>
    </section>

    <!-- ── Error ─────────────────────────────────────────────── -->
    <?php if ($errorMessage !== ""): ?>
      <section class="error">
        <strong>Error:</strong> <?php echo h($errorMessage); ?>
      </section>
    <?php endif; ?>

    <!-- ── Artist Search Results ──────────────────────────────── -->
    <?php if ($artistResults && !empty($artistResults['artists'])): ?>
      <section class="artist-result">
        <h2>Artist Results</h2>
        <?php foreach ($artistResults['artists'] as $artist): ?>
          <div class="artist-card">
            <h3><?php echo h($artist['name']); ?></h3>
            <?php if (!empty($artist['albums'])): ?>
              <div class="album-grid">
                <?php foreach ($artist['albums'] as $al): ?>
                  <div class="album-item">
                    <span class="album-title"><?php echo h($al['title']); ?></span>
                    <span class="album-meta">
                      <?php
                        $parts = [];
                        if (!empty($al['releaseDate'])) $parts[] = substr($al['releaseDate'], 0, 4);
                        if (!empty($al['trackCount'])) $parts[] = $al['trackCount'] . ' tracks';
                        echo h(implode(' · ', $parts));
                      ?>
                    </span>
                    <form method="post" style="margin:0" onsubmit="this.classList.add('submitting')">
                      <input type="hidden" name="action" value="album">
                      <input type="hidden" name="album" value="<?php echo h($al['id']); ?>">
                      <button type="submit" class="btn-dl-album">Download Album <span class="loading">&#8987;</span></button>
                    </form>
                  </div>
                <?php endforeach; ?>
              </div>
            <?php else: ?>
              <p style="color:var(--muted);font-size:.9rem;">No albums found for this artist.</p>
            <?php endif; ?>
          </div>
        <?php endforeach; ?>
      </section>
    <?php endif; ?>

    <!-- ── Download Summary ──────────────────────────────────── -->
    <?php if ($downloadSummary): ?>
      <section class="card" style="margin-top:20px;">
        <h2>Download Complete: <?php echo h($downloadSummary['playlist'] ?? ''); ?></h2>
        <div class="summary-grid">
          <div class="summary-stat"><?php echo (int)($downloadSummary['completed'] ?? 0); ?><small>Downloaded</small></div>
          <?php if (($downloadSummary['noMatch'] ?? 0) > 0): ?>
            <div class="summary-stat stat-warn"><?php echo (int)$downloadSummary['noMatch']; ?><small>No Match</small></div>
          <?php endif; ?>
          <?php if (($downloadSummary['downloadFailed'] ?? 0) > 0): ?>
            <div class="summary-stat stat-err"><?php echo (int)$downloadSummary['downloadFailed']; ?><small>Failed</small></div>
          <?php endif; ?>
          <div class="summary-stat"><?php echo (int)($downloadSummary['total'] ?? 0); ?><small>Total</small></div>
        </div>

        <?php
          // Show download links for completed tracks
          $plFolder = basename($downloadSummary['outputDir'] ?? '');
          $completedTracks = array_filter($downloadSummary['tracks'] ?? [], fn($t) => ($t['status'] ?? '') === 'ok' && !empty($t['file']));
        ?>
        <?php if (count($completedTracks) > 0 && $plFolder): ?>
          <div style="margin-bottom:10px;">
            <a href="?zip=<?php echo urlencode($plFolder); ?>" class="btn-sm btn-zip" style="color:#fff;text-decoration:none;display:inline-block;padding:8px 16px;border-radius:8px;">
              Download All (.zip)
            </a>
          </div>
          <ul class="track-list">
            <?php foreach ($completedTracks as $t): ?>
              <li>
                <span class="track-name"><?php echo h(implode(", ", $t['artists'] ?? []) . " - " . ($t['title'] ?? '')); ?></span>
                <a class="dl-link" href="?serve=<?php echo urlencode($plFolder . "/" . $t['file']); ?>">Download MP3</a>
              </li>
            <?php endforeach; ?>
          </ul>
        <?php endif; ?>
      </section>
    <?php endif; ?>

    <!-- ── Command Output ────────────────────────────────────── -->
    <?php if ($resultCommand !== ""): ?>
      <section class="result">
        <div class="meta">
          Command: <?php echo h($resultCommand); ?><br>
          Exit code:
          <?php if ($resultExitCode === 0): ?>
            <span class="status-ok"><?php echo h((string) $resultExitCode); ?></span>
          <?php else: ?>
            <span class="status-bad"><?php echo h((string) $resultExitCode); ?></span>
          <?php endif; ?>
        </div>
        <pre><?php echo h(trim($resultOutput)); ?></pre>
      </section>
    <?php endif; ?>

    <!-- ── Downloaded Library ────────────────────────────────── -->
    <?php if (count($existingPlaylists) > 0): ?>
      <section class="library">
        <h2>Downloaded Library</h2>
        <?php foreach ($existingPlaylists as $pl): ?>
          <div class="playlist-card">
            <h3><?php echo h($pl['name']); ?> <small style="color:var(--muted);font-weight:400">(<?php echo $pl['count']; ?> tracks)</small></h3>
            <a href="?zip=<?php echo urlencode($pl['name']); ?>" class="btn-sm btn-zip" style="color:#fff;text-decoration:none;display:inline-block;margin-bottom:8px;">
              Download All (.zip)
            </a>
            <ul class="track-list">
              <?php foreach ($pl['files'] as $file): ?>
                <li>
                  <span class="track-name"><?php echo h($file); ?></span>
                  <a class="dl-link" href="?serve=<?php echo urlencode($pl['name'] . "/" . $file); ?>">Download</a>
                </li>
              <?php endforeach; ?>
            </ul>
          </div>
        <?php endforeach; ?>
      </section>
    <?php endif; ?>

    <p class="footnote">
      Security: this page runs local commands. Do not expose publicly.
    </p>
<?php endif; ?>
  </main>

  <!-- ── Progress Modal ── -->
  <div class="progress-overlay" id="progressOverlay">
    <div class="progress-modal">
      <h2 class="progress-header" id="progressTitle">Downloading...</h2>
      <p class="progress-sub" id="progressSub"></p>
      <div class="progress-bar-wrap"><div class="progress-bar" id="progressBar"></div></div>
      <p class="progress-pct" id="progressPct">0 / 0</p>
      <div class="progress-current" id="progressCurrent">
        <div class="spinner"></div>
        <span>Preparing...</span>
      </div>
      <div class="progress-tracks" id="progressTracks">
        <ul id="progressTrackList"></ul>
      </div>
      <details class="progress-log">
        <summary>Raw log</summary>
        <pre id="progressLogPre"></pre>
      </details>
      <div class="progress-actions" id="progressActions" style="display:none;">
        <button class="btn-muted" onclick="closeProgress()">Close</button>
        <a id="progressZipLink" class="btn-sm btn-zip" style="display:none;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">Download All (.zip)</a>
      </div>
    </div>
  </div>

  <script>
    // ── Theme toggle ──
    (function() {
      const root = document.documentElement;
      const btns = document.querySelectorAll('#themeToggle button');
      const stored = localStorage.getItem('musicer-theme') || 'auto';

      function apply(mode) {
        root.removeAttribute('data-theme');
        if (mode === 'dark') root.setAttribute('data-theme', 'dark');
        else if (mode === 'light') root.setAttribute('data-theme', 'light');
        btns.forEach(b => b.classList.toggle('active', b.dataset.theme === mode));
        localStorage.setItem('musicer-theme', mode);
      }

      btns.forEach(b => b.addEventListener('click', () => apply(b.dataset.theme)));
      apply(stored);
    })();

    // ── Progress streaming ──
    (function() {
      const overlay = document.getElementById('progressOverlay');
      const title = document.getElementById('progressTitle');
      const sub = document.getElementById('progressSub');
      const bar = document.getElementById('progressBar');
      const pct = document.getElementById('progressPct');
      const current = document.getElementById('progressCurrent');
      const trackList = document.getElementById('progressTrackList');
      const logPre = document.getElementById('progressLogPre');
      const actions = document.getElementById('progressActions');
      const zipLink = document.getElementById('progressZipLink');

      let totalTracks = 0;
      let completedTracks = 0;
      let trackElements = {};

      function esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
      }

      function statusIcon(status) {
        switch (status) {
          case 'ok':            return '<span class="t-icon ok">&#10003;</span>';
          case 'exists':        return '<span class="t-icon ok">&#10003;</span>';
          case 'no-match':      return '<span class="t-icon skip">&#8212;</span>';
          case 'download-fail': return '<span class="t-icon fail">&#10007;</span>';
          case 'tag-fail':      return '<span class="t-icon fail">!</span>';
          case 'searching':     return '<span class="t-icon"><span class="spinner" style="width:14px;height:14px;display:inline-block;border-width:2px"></span></span>';
          case 'downloading':   return '<span class="t-icon"><span class="spinner" style="width:14px;height:14px;display:inline-block;border-width:2px;border-top-color:var(--ok)"></span></span>';
          default:              return '<span class="t-icon wait">&#183;</span>';
        }
      }

      function statusLabel(status) {
        switch (status) {
          case 'ok':            return 'Done';
          case 'exists':        return 'Updated';
          case 'no-match':      return 'No match';
          case 'download-fail': return 'Failed';
          case 'tag-fail':      return 'Tag error';
          case 'searching':     return 'Searching...';
          case 'downloading':   return 'Downloading...';
          default:              return '';
        }
      }

      function isFinal(status) {
        return ['ok', 'exists', 'no-match', 'download-fail', 'tag-fail'].includes(status);
      }

      function updateTrack(idx, trackTitle, artists, status) {
        const key = idx;
        const label = (artists || []).join(', ') + ' \u2013 ' + trackTitle;

        if (!trackElements[key]) {
          const li = document.createElement('li');
          li.innerHTML = statusIcon(status) +
            '<span class="t-name">' + esc(label) + '</span>' +
            '<span class="t-status">' + statusLabel(status) + '</span>';
          trackList.appendChild(li);
          trackElements[key] = li;
        } else {
          const li = trackElements[key];
          li.innerHTML = statusIcon(status) +
            '<span class="t-name">' + esc(label) + '</span>' +
            '<span class="t-status">' + statusLabel(status) + '</span>';
        }

        // Auto-scroll track list
        const container = document.getElementById('progressTracks');
        container.scrollTop = container.scrollHeight;
      }

      function updateBar() {
        if (totalTracks === 0) return;
        const pctVal = Math.round((completedTracks / totalTracks) * 100);
        bar.style.width = pctVal + '%';
        pct.textContent = completedTracks + ' / ' + totalTracks + ' tracks';
      }

      function showCurrent(text, showSpinner) {
        current.innerHTML = (showSpinner ? '<div class="spinner"></div>' : '') +
          '<span>' + esc(text) + '</span>';
      }

      function appendLog(text) {
        logPre.textContent += text + '\n';
        logPre.scrollTop = logPre.scrollHeight;
      }

      function openProgress(actionLabel) {
        totalTracks = 0;
        completedTracks = 0;
        trackElements = {};
        trackList.innerHTML = '';
        logPre.textContent = '';
        bar.style.width = '0%';
        pct.textContent = '';
        actions.style.display = 'none';
        zipLink.style.display = 'none';
        title.textContent = actionLabel;
        sub.textContent = '';
        showCurrent('Connecting to TIDAL...', true);
        overlay.classList.add('active');
      }

      window.closeProgress = function() {
        overlay.classList.remove('active');
        // Reload page to refresh library
        window.location.href = window.location.pathname;
      };

      async function startStream(action, input, label) {
        openProgress(label);

        const formData = new FormData();
        formData.append('action', action);
        formData.append('input', input);

        let jobId = null;

        try {
          // Start the background job
          const startResp = await fetch(window.location.pathname, {
            method: 'POST',
            headers: { 'X-Stream': '1' },
            body: formData,
          });
          const startData = await startResp.json();
          if (startData.error) {
            showCurrent('Error: ' + startData.error, false);
            actions.style.display = 'flex';
            return;
          }
          jobId = startData.jobId;
        } catch (err) {
          showCurrent('Failed to start: ' + err.message, false);
          actions.style.display = 'flex';
          return;
        }

        // Poll for progress events
        let cursor = 0;
        let polling = true;

        async function poll() {
          try {
            const resp = await fetch(window.location.pathname + '?poll=' + jobId + '&cursor=' + cursor);
            const data = await resp.json();
            cursor = data.cursor;

            for (const event of data.events) {
              handleProgressEvent(event);
            }

            if (data.done) {
              polling = false;
              return;
            }
          } catch (err) {
            appendLog('Poll error: ' + err.message);
          }

          if (polling) {
            setTimeout(poll, 400);
          }
        }

        poll();
      }

      function handleProgressEvent(event) {
        if (!event || !event.type) return;

        switch (event.type) {
          case 'progress': {
            const d = event.data;
            if (d.phase === 'fetching') {
              showCurrent(d.message || 'Fetching...', true);
            } else if (d.phase === 'starting') {
              totalTracks = d.total || 0;
              sub.textContent = (d.name || '') + ' \u2014 ' + totalTracks + ' tracks';
              updateBar();
              showCurrent('Starting download...', true);
            } else if (d.phase === 'track') {
              const idx = d.current;
              updateTrack(idx, d.title, d.artists, d.status);

              if (isFinal(d.status)) {
                completedTracks = idx;
                updateBar();
                if (d.status === 'ok' || d.status === 'exists') {
                  showCurrent(d.title + ' \u2014 done', false);
                } else {
                  showCurrent(d.title + ' \u2014 ' + statusLabel(d.status), false);
                }
              } else {
                showCurrent(d.title + ' \u2014 ' + statusLabel(d.status), true);
              }
            }
            break;
          }
          case 'summary': {
            const s = event.data;
            const folder = s.outputDir ? s.outputDir.split(/[\/\\]/).pop() : '';
            if (folder) {
              zipLink.href = '?zip=' + encodeURIComponent(folder);
              zipLink.textContent = 'Download All (.zip)';
              zipLink.style.display = 'inline-block';
            }
            title.textContent = 'Download Complete';
            showCurrent(
              s.completed + ' downloaded' +
              (s.noMatch ? ', ' + s.noMatch + ' no match' : '') +
              (s.downloadFailed ? ', ' + s.downloadFailed + ' failed' : ''),
              false
            );
            break;
          }
          case 'log':
            appendLog(typeof event.data === 'string' ? event.data : JSON.stringify(event.data));
            break;
          case 'done': {
            actions.style.display = 'flex';
            const exitCode = event.data ? event.data.exitCode : -1;
            if (exitCode !== 0) {
              showCurrent('Process exited with code ' + exitCode, false);
            }
            break;
          }
        }
      }

      // Intercept download form
      const dlForm = document.getElementById('form-download');
      if (dlForm) {
        dlForm.addEventListener('submit', function(e) {
          e.preventDefault();
          const input = dlForm.querySelector('#playlist').value.trim();
          if (!input) return;
          startStream('download', input, 'Downloading Playlist');
        });
      }

      // Intercept album form
      const alForm = document.getElementById('form-album');
      if (alForm) {
        alForm.addEventListener('submit', function(e) {
          e.preventDefault();
          const input = alForm.querySelector('#album').value.trim();
          if (!input) return;
          startStream('album', input, 'Downloading Album');
        });
      }

      // Intercept album download buttons from artist search results
      document.addEventListener('click', function(e) {
        const btn = e.target.closest('.btn-dl-album');
        if (!btn) return;
        const form = btn.closest('form');
        if (!form) return;
        const albumId = form.querySelector('input[name="album"]');
        if (!albumId) return;
        e.preventDefault();
        startStream('album', albumId.value, 'Downloading Album');
      });
    })();
  </script>
</body>
</html>
