"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
// Use require() so tsx/cjs resolves the .ts file at load time.
// Both functions read process.env at call-time so module caching is not an issue.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getOptionalEnv, getRequiredTidalEnv } = require("./env");
const TIDAL_VARS = [
    "TIDAL_ACCESS_TOKEN",
    "TIDAL_CLIENT_ID",
    "TIDAL_CLIENT_SECRET",
    "TIDAL_AUTH_BASE_URL",
    "TIDAL_API_BASE_URL",
    "TIDAL_COUNTRY_CODE",
];
const APP_VARS = ["OUTPUT_DIR", "YT_DLP_PATH", "FFMPEG_PATH"];
let saved = {};
(0, node_test_1.beforeEach)(() => {
    // Save and clear all relevant env vars
    for (const k of [...TIDAL_VARS, ...APP_VARS]) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
});
(0, node_test_1.afterEach)(() => {
    // Restore
    for (const k of [...TIDAL_VARS, ...APP_VARS]) {
        if (saved[k] === undefined) {
            delete process.env[k];
        }
        else {
            process.env[k] = saved[k];
        }
    }
});
(0, node_test_1.describe)("getOptionalEnv", () => {
    (0, node_test_1.test)("returns defaults when env vars are absent", () => {
        const env = getOptionalEnv();
        strict_1.default.equal(env.outputDir, "./downloads");
        strict_1.default.equal(env.ytDlpPath, undefined);
        strict_1.default.equal(env.ffmpegPath, undefined);
    });
    (0, node_test_1.test)("reads OUTPUT_DIR from environment", () => {
        process.env.OUTPUT_DIR = "/custom/path";
        const env = getOptionalEnv();
        strict_1.default.equal(env.outputDir, "/custom/path");
    });
    (0, node_test_1.test)("reads YT_DLP_PATH from environment", () => {
        process.env.YT_DLP_PATH = "C:\\ytdlp\\yt-dlp.exe";
        const env = getOptionalEnv();
        strict_1.default.equal(env.ytDlpPath, "C:\\ytdlp\\yt-dlp.exe");
    });
    (0, node_test_1.test)("reads FFMPEG_PATH from environment", () => {
        process.env.FFMPEG_PATH = "C:\\ffmpeg\\bin\\";
        const env = getOptionalEnv();
        strict_1.default.equal(env.ffmpegPath, "C:\\ffmpeg\\bin\\");
    });
});
(0, node_test_1.describe)("getRequiredTidalEnv", () => {
    (0, node_test_1.test)("throws when no TIDAL credentials are set", () => {
        strict_1.default.throws(() => getRequiredTidalEnv(), /Missing TIDAL credentials/);
    });
    (0, node_test_1.test)("accepts TIDAL_ACCESS_TOKEN alone", () => {
        process.env.TIDAL_ACCESS_TOKEN = "tok_abc";
        const env = getRequiredTidalEnv();
        strict_1.default.equal(env.tidalAccessToken, "tok_abc");
    });
    (0, node_test_1.test)("accepts TIDAL_CLIENT_ID + TIDAL_CLIENT_SECRET", () => {
        process.env.TIDAL_CLIENT_ID = "id_123";
        process.env.TIDAL_CLIENT_SECRET = "sec_456";
        const env = getRequiredTidalEnv();
        strict_1.default.equal(env.tidalClientId, "id_123");
        strict_1.default.equal(env.tidalClientSecret, "sec_456");
    });
    (0, node_test_1.test)("uses default TIDAL API base URLs when not set", () => {
        process.env.TIDAL_ACCESS_TOKEN = "tok";
        const env = getRequiredTidalEnv();
        strict_1.default.equal(env.tidalAuthBaseUrl, "https://auth.tidal.com");
        strict_1.default.equal(env.tidalApiBaseUrl, "https://openapi.tidal.com/v2");
        strict_1.default.equal(env.tidalCountryCode, "US");
    });
    (0, node_test_1.test)("respects overridden TIDAL base URLs", () => {
        process.env.TIDAL_ACCESS_TOKEN = "tok";
        process.env.TIDAL_AUTH_BASE_URL = "https://custom.auth";
        process.env.TIDAL_API_BASE_URL = "https://custom.api/v2";
        process.env.TIDAL_COUNTRY_CODE = "GB";
        const env = getRequiredTidalEnv();
        strict_1.default.equal(env.tidalAuthBaseUrl, "https://custom.auth");
        strict_1.default.equal(env.tidalApiBaseUrl, "https://custom.api/v2");
        strict_1.default.equal(env.tidalCountryCode, "GB");
    });
    (0, node_test_1.test)("trims whitespace from credentials", () => {
        process.env.TIDAL_ACCESS_TOKEN = "  tok_padded  ";
        const env = getRequiredTidalEnv();
        strict_1.default.equal(env.tidalAccessToken, "tok_padded");
    });
});
