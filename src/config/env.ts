import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });

export interface AppEnv {
  outputDir: string;
  ytDlpPath?: string;
  ffmpegPath?: string;
}

export interface TidalEnv {
  tidalAccessToken?: string;
  tidalClientId?: string;
  tidalClientSecret?: string;
  tidalAuthBaseUrl: string;
  tidalCountryCode: string;
  tidalApiBaseUrl: string;
}

export function getOptionalEnv(): Pick<AppEnv, "outputDir" | "ytDlpPath" | "ffmpegPath"> {
  return {
    outputDir: process.env.OUTPUT_DIR || "./downloads",
    ytDlpPath: process.env.YT_DLP_PATH || undefined,
    ffmpegPath: process.env.FFMPEG_PATH || undefined,
  };
}

export function getRequiredTidalEnv(): TidalEnv {
  const tidalAccessToken = process.env.TIDAL_ACCESS_TOKEN?.trim() || undefined;
  const tidalClientId = process.env.TIDAL_CLIENT_ID?.trim() || undefined;
  const tidalClientSecret = process.env.TIDAL_CLIENT_SECRET?.trim() || undefined;
  const tidalAuthBaseUrl =
    process.env.TIDAL_AUTH_BASE_URL?.trim() || "https://auth.tidal.com";
  const tidalCountryCode = process.env.TIDAL_COUNTRY_CODE || "US";
  const tidalApiBaseUrl = process.env.TIDAL_API_BASE_URL || "https://openapi.tidal.com/v2";

  const hasAccessToken = Boolean(tidalAccessToken);
  const hasClientCredentials = Boolean(tidalClientId && tidalClientSecret);

  if (!hasAccessToken && !hasClientCredentials) {
    throw new Error(
      "Missing TIDAL credentials: set TIDAL_ACCESS_TOKEN or both TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET"
    );
  }

  return {
    tidalAccessToken,
    tidalClientId,
    tidalClientSecret,
    tidalAuthBaseUrl,
    tidalCountryCode,
    tidalApiBaseUrl,
  };
}
