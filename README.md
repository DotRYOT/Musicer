# Musicer (MVP In Progress)

Musicer is a local CLI to read TIDAL playlists and build a download pipeline toward YouTube source audio with MP3 metadata embedding.

## Legal Notice

This project is intended for personal-use scenarios only.
Using it may violate platform Terms of Service and local laws depending on jurisdiction and content rights.
You are fully responsible for compliance.

## Current Status

Phase 1 foundation is implemented:
- CLI scaffold
- Consent gate
- Env/runtime checks
- TIDAL auth configuration and API ingestion path
- Download command skeleton

YouTube search, matching scorer, audio download, and metadata writing are next.

## Prerequisites

- Node.js 20+
- TIDAL access token, or TIDAL Client ID + Client Secret
- `yt-dlp` available in PATH
- `ffmpeg` available in PATH

## Setup

1. Install dependencies:

```powershell
npm install
```

2. Create `.env` from `.env.example` and set TIDAL credentials:
	- Option A: `TIDAL_ACCESS_TOKEN`
	- Option B: `TIDAL_CLIENT_ID` + `TIDAL_CLIENT_SECRET`
	- Optional: `TIDAL_COUNTRY_CODE`, `TIDAL_AUTH_BASE_URL`, `TIDAL_API_BASE_URL`

TIDAL note: values shown as Client ID and Client Secret in the TIDAL dashboard are not the same as TIDAL_ACCESS_TOKEN. Musicer can automatically request an access token when client credentials are provided.

Reference: https://developer.tidal.com/documentation/api-sdk/api-sdk-authorization

3. Build:

```powershell
npm run build
```

4. Run checks:

```powershell
npm run dev -- check
```

## Web UI (PHP)

If you are using XAMPP, you can run Musicer from your browser:

1. Start Apache.
2. Open `http://localhost/Musicer/`.
3. Use the forms to run:
	- Environment check
	- Consent acceptance
	- Auth status
	- Playlist download command

Important: this UI executes local shell commands in the project directory. Keep it local-only and do not expose publicly.

## Commands

```powershell
npm run dev -- consent
npm run dev -- consent --accept
npm run dev -- check
npm run dev -- auth login
npm run dev -- auth complete
npm run dev -- download <tidal-playlist-url-or-id>
```

## Next Milestones

- yt-dlp search integration
- Track matching score engine
- MP3 download/conversion pipeline
- ID3 metadata + cover art embedding
- Unit/integration tests
