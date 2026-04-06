import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
// Use require() so tsx/cjs resolves the .ts file at load time.
// Both functions read process.env at call-time so module caching is not an issue.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getOptionalEnv, getRequiredTidalEnv } = require("./env") as typeof import("./env");

const TIDAL_VARS = [
  "TIDAL_ACCESS_TOKEN",
  "TIDAL_CLIENT_ID",
  "TIDAL_CLIENT_SECRET",
  "TIDAL_AUTH_BASE_URL",
  "TIDAL_API_BASE_URL",
  "TIDAL_COUNTRY_CODE",
];
const APP_VARS = ["OUTPUT_DIR", "YT_DLP_PATH", "FFMPEG_PATH"];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  // Save and clear all relevant env vars
  for (const k of [...TIDAL_VARS, ...APP_VARS]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  // Restore
  for (const k of [...TIDAL_VARS, ...APP_VARS]) {
    if (saved[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = saved[k];
    }
  }
});

describe("getOptionalEnv", () => {
  test("returns defaults when env vars are absent", () => {
    const env = getOptionalEnv();
    assert.equal(env.outputDir, "./downloads");
    assert.equal(env.ytDlpPath, undefined);
    assert.equal(env.ffmpegPath, undefined);
  });

  test("reads OUTPUT_DIR from environment", () => {
    process.env.OUTPUT_DIR = "/custom/path";
    const env = getOptionalEnv();
    assert.equal(env.outputDir, "/custom/path");
  });

  test("reads YT_DLP_PATH from environment", () => {
    process.env.YT_DLP_PATH = "C:\\ytdlp\\yt-dlp.exe";
    const env = getOptionalEnv();
    assert.equal(env.ytDlpPath, "C:\\ytdlp\\yt-dlp.exe");
  });

  test("reads FFMPEG_PATH from environment", () => {
    process.env.FFMPEG_PATH = "C:\\ffmpeg\\bin\\";
    const env = getOptionalEnv();
    assert.equal(env.ffmpegPath, "C:\\ffmpeg\\bin\\");
  });
});

describe("getRequiredTidalEnv", () => {
  test("throws when no TIDAL credentials are set", () => {
    assert.throws(() => getRequiredTidalEnv(), /Missing TIDAL credentials/);
  });

  test("accepts TIDAL_ACCESS_TOKEN alone", () => {
    process.env.TIDAL_ACCESS_TOKEN = "tok_abc";
    const env = getRequiredTidalEnv();
    assert.equal(env.tidalAccessToken, "tok_abc");
  });

  test("accepts TIDAL_CLIENT_ID + TIDAL_CLIENT_SECRET", () => {
    process.env.TIDAL_CLIENT_ID = "id_123";
    process.env.TIDAL_CLIENT_SECRET = "sec_456";
    const env = getRequiredTidalEnv();
    assert.equal(env.tidalClientId, "id_123");
    assert.equal(env.tidalClientSecret, "sec_456");
  });

  test("uses default TIDAL API base URLs when not set", () => {
    process.env.TIDAL_ACCESS_TOKEN = "tok";
    const env = getRequiredTidalEnv();
    assert.equal(env.tidalAuthBaseUrl, "https://auth.tidal.com");
    assert.equal(env.tidalApiBaseUrl, "https://openapi.tidal.com/v2");
    assert.equal(env.tidalCountryCode, "US");
  });

  test("respects overridden TIDAL base URLs", () => {
    process.env.TIDAL_ACCESS_TOKEN = "tok";
    process.env.TIDAL_AUTH_BASE_URL = "https://custom.auth";
    process.env.TIDAL_API_BASE_URL = "https://custom.api/v2";
    process.env.TIDAL_COUNTRY_CODE = "GB";
    const env = getRequiredTidalEnv();
    assert.equal(env.tidalAuthBaseUrl, "https://custom.auth");
    assert.equal(env.tidalApiBaseUrl, "https://custom.api/v2");
    assert.equal(env.tidalCountryCode, "GB");
  });

  test("trims whitespace from credentials", () => {
    process.env.TIDAL_ACCESS_TOKEN = "  tok_padded  ";
    const env = getRequiredTidalEnv();
    assert.equal(env.tidalAccessToken, "tok_padded");
  });
});
