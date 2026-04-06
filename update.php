<?php
/**
 * Musicer — In-app updater
 *
 * Compares local version.php against GitHub remote,
 * downloads the repo ZIP, and overlays new files while
 * protecting user data (downloads/, .env, node_modules/, etc.).
 */

$projectDir       = realpath(__DIR__);
$localVersionFile = $projectDir . DIRECTORY_SEPARATOR . 'version.php';
$remoteVersionUrl = 'https://raw.githubusercontent.com/DotRYOT/Musicer/main/version.php';

// ── Helpers ────────────────────────────────────────────────────────

function esc($value)
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function renderPageStart()
{
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<link rel="icon" type="image/svg+xml" href="favicon.svg">';
    echo '<title>Musicer Updater</title>';
    echo '<style>
        :root { color-scheme: dark; }
        body { margin:0; font-family:Inter,Segoe UI,Arial,sans-serif; background:#0f1115; color:#e5e7eb; }
        .wrap { max-width:880px; margin:2rem auto; padding:0 1rem; }
        .card { background:#161b22; border:1px solid #30363d; border-radius:12px; padding:1.1rem 1.2rem; }
        h2 { margin-top:0; }
        .row { margin:.6rem 0; }
        .ok  { color:#3fb950; }
        .warn{ color:#d29922; }
        .err { color:#f85149; }
        pre  { background:#0d1117; border:1px solid #30363d; border-radius:10px; padding:.8rem; overflow-x:auto; margin:.6rem 0; }
        a.btn { display:inline-block; text-decoration:none; background:#016a70; color:#fff; border-radius:10px; padding:.6rem .9rem; margin-top:.6rem; }
        a.btn:hover { background:#044b50; }
    </style></head><body><div class="wrap"><div class="card">';
    echo '<h2>Musicer Update Checker</h2>';
}

function renderPageEnd()
{
    echo '<a class="btn" href="./">Return to Musicer</a>';
    echo '</div></div></body></html>';
}

function failAndExit($message)
{
    echo '<p class="err">' . esc($message) . '</p>';
    renderPageEnd();
    exit(1);
}

function info($message, $class = '')
{
    $className = $class ? ' class="' . esc($class) . '"' : '';
    echo '<p' . $className . '>' . esc($message) . '</p>';
    @flush();
}

function fetchRemoteFile($url)
{
    if (function_exists('curl_init')) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Musicer-Updater/1.0');
        $response   = curl_exec($ch);
        $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($response === false || $statusCode >= 400) {
            return null;
        }
        return $response;
    }

    $context = stream_context_create([
        'http' => [
            'timeout' => 15,
            'header'  => "User-Agent: Musicer-Updater/1.0\r\n",
        ],
    ]);
    $result = @file_get_contents($url, false, $context);
    return $result === false ? null : $result;
}

function downloadBinaryFile($url, $destinationPath)
{
    if (function_exists('curl_init')) {
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Musicer-Updater/1.0');
        $data       = curl_exec($ch);
        $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($data === false || $statusCode >= 400) {
            return false;
        }
    } else {
        $context = stream_context_create([
            'http' => [
                'timeout' => 60,
                'header'  => "User-Agent: Musicer-Updater/1.0\r\n",
            ],
        ]);
        $data = @file_get_contents($url, false, $context);
        if ($data === false) {
            return false;
        }
    }
    return file_put_contents($destinationPath, $data) !== false;
}

function removeDirectory($dir)
{
    if (!is_dir($dir)) return;
    $items = scandir($dir);
    if ($items === false) return;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $dir . DIRECTORY_SEPARATOR . $item;
        if (is_dir($path)) {
            removeDirectory($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($dir);
}

function shouldSkipPath($relativePath)
{
    $normalized = str_replace('\\', '/', ltrim($relativePath, '/'));

    // Directories that must never be overwritten
    $protectedPrefixes = [
        '.git/',
        '.env',
        'node_modules/',
        'downloads/',
        'dist/',
        'media/',
    ];

    // Individual files that must be preserved
    $protectedFiles = [
        '.env',
        '.consent',
    ];

    foreach ($protectedPrefixes as $prefix) {
        if (strpos($normalized, $prefix) === 0) {
            return true;
        }
    }

    return in_array($normalized, $protectedFiles, true);
}

function copyDirectoryWithProtection($sourceDir, $targetDir)
{
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($sourceDir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($iterator as $item) {
        $sourcePath   = $item->getPathname();
        $relativePath = substr($sourcePath, strlen($sourceDir) + 1);
        $relativePath = str_replace('\\', '/', $relativePath);

        if (shouldSkipPath($relativePath)) {
            continue;
        }

        $destinationPath = $targetDir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);

        if ($item->isDir()) {
            if (!is_dir($destinationPath)) {
                mkdir($destinationPath, 0777, true);
            }
            continue;
        }

        $destinationDir = dirname($destinationPath);
        if (!is_dir($destinationDir)) {
            mkdir($destinationDir, 0777, true);
        }

        if (!copy($sourcePath, $destinationPath)) {
            throw new RuntimeException('Failed to copy file: ' . $relativePath);
        }
    }
}

function runZipUpdate($projectDir)
{
    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('PHP Zip extension is required. Enable extension=zip in php.ini.');
    }

    $archiveUrl = 'https://codeload.github.com/DotRYOT/Musicer/zip/refs/heads/main';
    $tempBase   = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'musicer_update_' . uniqid();
    $zipFile    = $tempBase . '.zip';

    info('Downloading update archive...', 'warn');

    if (!downloadBinaryFile($archiveUrl, $zipFile)) {
        throw new RuntimeException('Failed to download update archive from GitHub.');
    }

    if (!mkdir($tempBase, 0777, true) && !is_dir($tempBase)) {
        @unlink($zipFile);
        throw new RuntimeException('Failed to create temporary directory for update.');
    }

    info('Extracting archive...', 'warn');

    $zip = new ZipArchive();
    if ($zip->open($zipFile) !== true) {
        @unlink($zipFile);
        removeDirectory($tempBase);
        throw new RuntimeException('Failed to open downloaded update archive.');
    }

    if (!$zip->extractTo($tempBase)) {
        $zip->close();
        @unlink($zipFile);
        removeDirectory($tempBase);
        throw new RuntimeException('Failed to extract update archive.');
    }
    $zip->close();

    // GitHub ZIP extracts into a single root folder (e.g. "Musicer-main/")
    $entries    = scandir($tempBase);
    $rootFolder = null;
    if ($entries !== false) {
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $fullPath = $tempBase . DIRECTORY_SEPARATOR . $entry;
            if (is_dir($fullPath)) {
                $rootFolder = $fullPath;
                break;
            }
        }
    }

    if ($rootFolder === null) {
        @unlink($zipFile);
        removeDirectory($tempBase);
        throw new RuntimeException('Extracted archive is missing root folder.');
    }

    info('Applying update (preserving downloads, .env, node_modules)...', 'warn');

    copyDirectoryWithProtection($rootFolder, $projectDir);

    @unlink($zipFile);
    removeDirectory($tempBase);
}

// ── Main ───────────────────────────────────────────────────────────

renderPageStart();
@set_time_limit(120);
@ignore_user_abort(true);
@ob_implicit_flush(true);

if ($projectDir === false || !is_dir($projectDir)) {
    failAndExit('Project directory could not be resolved.');
}

if (!file_exists($localVersionFile)) {
    failAndExit('Local version.php not found.');
}

include $localVersionFile;
if (!isset($version) || trim($version) === '') {
    failAndExit('Local version variable is missing in version.php.');
}

$localVersion      = trim($version);
$remoteVersionFile = fetchRemoteFile($remoteVersionUrl);

if ($remoteVersionFile === null) {
    failAndExit('Could not fetch remote version information from GitHub.');
}

if (!preg_match('/\$version\s*=\s*[\"\']([^\"\']+)[\"\']\s*;/', $remoteVersionFile, $matches)) {
    failAndExit('Remote version format is invalid.');
}

$remoteVersion = trim($matches[1]);

info('Local version:  ' . $localVersion);
info('Remote version: ' . $remoteVersion);

if (version_compare($localVersion, $remoteVersion, '>=')) {
    info('Already up to date. No update required.', 'ok');
    renderPageEnd();
    exit(0);
}

info('New version available: ' . $remoteVersion . '. Starting update...', 'warn');

try {
    runZipUpdate($projectDir);

    // Re-read version after update
    unset($version);
    include $localVersionFile;
    $updatedVersion = isset($version) ? trim($version) : 'unknown';

    info('Update complete! Now at version ' . $updatedVersion, 'ok');
    info('Run "npm install && npm run build" if dependencies changed.', 'warn');
} catch (Throwable $exception) {
    failAndExit($exception->getMessage());
}

renderPageEnd();
