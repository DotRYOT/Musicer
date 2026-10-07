"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTidalPlaylist = getTidalPlaylist;
exports.getTidalAlbum = getTidalAlbum;
exports.searchTidalArtists = searchTidalArtists;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
// ── Token cache ────────────────────────────────────────────────────
let cachedToken = null;
/**
 * Client-credentials flow per TIDAL docs:
 *   POST https://auth.tidal.com/v1/oauth2/token
 *   Authorization: Basic base64(CLIENT_ID:CLIENT_SECRET)
 *   grant_type=client_credentials
 */
async function resolveAccessToken(env) {
    if (env.tidalAccessToken) {
        return env.tidalAccessToken;
    }
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
        return cachedToken.token;
    }
    if (!env.tidalClientId || !env.tidalClientSecret) {
        throw new Error("TIDAL credential resolution failed. Provide TIDAL_ACCESS_TOKEN or both TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET.");
    }
    const basic = Buffer.from(`${env.tidalClientId}:${env.tidalClientSecret}`).toString("base64");
    const tokenUrl = `${env.tidalAuthBaseUrl}/v1/oauth2/token`;
    const res = await axios_1.default.post(tokenUrl, "grant_type=client_credentials", {
        headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    });
    const accessToken = res.data.access_token;
    if (!accessToken) {
        throw new Error("TIDAL token response did not include access_token.");
    }
    const expiresIn = res.data.expires_in ?? 86400;
    cachedToken = { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    return accessToken;
}
// ── Helpers ────────────────────────────────────────────────────────
function extractPlaylistId(input) {
    if (!input.includes("tidal.com"))
        return input;
    const match = input.match(/playlist\/([a-zA-Z0-9-]+)/);
    if (!match)
        throw new Error("Could not extract TIDAL playlist ID from URL.");
    return match[1];
}
function extractAlbumId(input) {
    if (!input.includes("tidal.com"))
        return input;
    const match = input.match(/album\/([0-9]+)/);
    if (!match)
        throw new Error("Could not extract TIDAL album ID from URL.");
    return match[1];
}
/** Authorization-only header; the v2 API rejects custom Accept/Content-Type on GET. */
function tidalHeaders(accessToken) {
    return {
        Authorization: `Bearer ${accessToken}`,
    };
}
function getString(val, fallback = "") {
    return typeof val === "string" ? val : fallback;
}
function getNumber(val, fallback = 0) {
    return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}
/** Parse ISO 8601 duration (e.g. "PT3M28S") to milliseconds. */
function parseIsoDuration(val) {
    if (typeof val !== "string")
        return 0;
    const m = val.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
    if (!m)
        return 0;
    const hours = parseInt(m[1] || "0", 10);
    const mins = parseInt(m[2] || "0", 10);
    const secs = parseFloat(m[3] || "0");
    return Math.round((hours * 3600 + mins * 60 + secs) * 1000);
}
// ── Track mapping ──────────────────────────────────────────────────
function mapTrackResource(resource, included) {
    const attrs = resource.attributes ?? {};
    // --- artists ---
    let artists = [];
    // Inline array of artist objects / strings
    if (Array.isArray(attrs.artists)) {
        artists = attrs.artists
            .map((a) => {
            if (typeof a === "string")
                return a;
            if (a && typeof a === "object" && "name" in a)
                return getString(a.name);
            return "";
        })
            .filter(Boolean);
    }
    // Single artistName attribute
    if (artists.length === 0 && attrs.artistName) {
        artists = [getString(attrs.artistName)];
    }
    // Resolve from included sideload via relationships
    if (artists.length === 0 && resource.relationships?.artists && included) {
        const refs = resource.relationships.artists.data;
        if (Array.isArray(refs)) {
            artists = refs
                .map((ref) => {
                const r = included.find((i) => i.type === ref.type && i.id === ref.id);
                return getString(r?.attributes?.name);
            })
                .filter(Boolean);
        }
    }
    // --- title ---
    const title = getString(attrs.title) || getString(attrs.name, "Unknown title");
    // --- album ---
    let album = "";
    if (attrs.album && typeof attrs.album === "object" && "title" in attrs.album) {
        album = getString(attrs.album.title);
    }
    if (!album)
        album = getString(attrs.albumTitle);
    // Resolve from included sideload
    if (!album && resource.relationships?.albums && included) {
        const refs = resource.relationships.albums.data;
        const ref = Array.isArray(refs) ? refs[0] : refs;
        if (ref) {
            const r = included.find((i) => i.type === ref.type && i.id === ref.id);
            if (r?.attributes?.title)
                album = getString(r.attributes.title);
        }
    }
    if (!album)
        album = "Unknown album";
    // --- duration (ISO 8601 e.g. "PT3M28S") ---
    const durationMs = parseIsoDuration(attrs.duration) ||
        getNumber(attrs.durationMs) ||
        Math.round(getNumber(attrs.durationSeconds, 0) * 1000);
    // --- track number / disc (not in track attributes; applied from relationship meta later) ---
    const trackNumber = undefined;
    const discNumber = undefined;
    // --- year ---
    let year;
    const releaseDate = getString(attrs.releaseDate);
    if (releaseDate && releaseDate.length >= 4) {
        year = releaseDate.slice(0, 4);
    }
    // Also try album release date from included
    if (!year && resource.relationships?.albums && included) {
        const refs = resource.relationships.albums.data;
        const ref = Array.isArray(refs) ? refs[0] : refs;
        if (ref) {
            const r = included.find((i) => i.type === ref.type && i.id === ref.id);
            const rd = getString(r?.attributes?.releaseDate);
            if (rd && rd.length >= 4)
                year = rd.slice(0, 4);
        }
    }
    // --- album artists ---
    let albumArtists = [];
    if (resource.relationships?.albums && included) {
        const refs = resource.relationships.albums.data;
        const ref = Array.isArray(refs) ? refs[0] : refs;
        if (ref) {
            const albumRes = included.find((i) => i.type === ref.type && i.id === ref.id);
            if (albumRes?.relationships?.artists) {
                const artRefs = albumRes.relationships.artists.data;
                if (Array.isArray(artRefs)) {
                    albumArtists = artRefs
                        .map((ar) => {
                        const r = included.find((i) => i.type === ar.type && i.id === ar.id);
                        return getString(r?.attributes?.name);
                    })
                        .filter(Boolean);
                }
            }
        }
    }
    // --- cover (track -> album included -> fallback) ---
    let coverUrl = getString(attrs.imageCover) ||
        getString(attrs.coverUrl) ||
        getString(attrs.imageUrl) ||
        undefined;
    if (!coverUrl && resource.relationships?.albums && included) {
        const refs = resource.relationships.albums.data;
        const ref = Array.isArray(refs) ? refs[0] : refs;
        if (ref) {
            const albumRes = included.find((i) => i.type === ref.type && i.id === ref.id);
            if (albumRes?.attributes) {
                coverUrl =
                    getString(albumRes.attributes.imageCover) ||
                        getString(albumRes.attributes.imageUrl) ||
                        undefined;
            }
        }
    }
    return {
        id: resource.id,
        title,
        artists,
        album,
        albumArtists: albumArtists.length > 0 ? albumArtists : undefined,
        durationMs,
        trackNumber,
        discNumber,
        year,
        isrc: getString(attrs.isrc) || undefined,
        coverUrl,
    };
}
// ── Paginated relationship fetch ───────────────────────────────────
const API_BASE = "https://openapi.tidal.com/v2";
/** Resolve a possibly-relative `links.next` URL to absolute. */
function resolveUrl(raw) {
    if (raw.startsWith("http"))
        return raw;
    return `${API_BASE}${raw.startsWith("/") ? "" : "/"}${raw}`;
}
/** Small delay to avoid TIDAL rate limits (429). */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Extract the best cover art URL from an artworks resource. Prefers 640x640. */
function extractArtworkUrl(artworkResource) {
    const files = artworkResource.attributes?.files;
    if (!Array.isArray(files))
        return undefined;
    // Prefer 640x640, fall back to largest available
    const preferred = files
        .find((f) => f.meta?.width === 640);
    if (preferred?.href)
        return preferred.href;
    const sorted = [...files]
        .filter((f) => f.href)
        .sort((a, b) => (b.meta?.width ?? 0) - (a.meta?.width ?? 0));
    return sorted[0]?.href || undefined;
}
/** Fetch track position metadata (trackNumber, volumeNumber) from album relationships. */
async function fetchAlbumTrackPositions(albumIds, headers, countryCode, apiBaseUrl) {
    const posMap = new Map();
    for (const albumId of albumIds) {
        try {
            const items = await fetchRelationshipItems(`${apiBaseUrl}/albums/${albumId}/relationships/items`, headers, countryCode);
            for (const item of items) {
                if (item.type === "tracks" && item.meta) {
                    const tn = getNumber(item.meta.trackNumber);
                    const vn = getNumber(item.meta.volumeNumber);
                    posMap.set(item.id, {
                        trackNumber: tn || undefined,
                        discNumber: vn || undefined,
                    });
                }
            }
        }
        catch {
            // skip album on error
        }
        await delay(200);
    }
    return posMap;
}
/** Fetch cover art URLs for a set of album IDs. */
async function fetchAlbumCovers(albumIds, headers, countryCode, apiBaseUrl) {
    const coverMap = new Map();
    const batchSize = 10;
    for (let i = 0; i < albumIds.length; i += batchSize) {
        const batch = albumIds.slice(i, i + batchSize);
        try {
            const res = await tidalGet(`${apiBaseUrl}/albums`, {
                headers,
                params: {
                    countryCode,
                    "filter[id]": batch.join(","),
                    include: "coverArt",
                },
            });
            const data = Array.isArray(res.data.data) ? res.data.data : res.data.data ? [res.data.data] : [];
            const inc = res.data.included || [];
            for (const album of data) {
                const coverRefs = album.relationships?.coverArt?.data;
                if (Array.isArray(coverRefs) && coverRefs.length > 0) {
                    const artwork = inc.find((r) => r.type === coverRefs[0].type && r.id === coverRefs[0].id);
                    if (artwork) {
                        const url = extractArtworkUrl(artwork);
                        if (url)
                            coverMap.set(album.id, url);
                    }
                }
            }
        }
        catch {
            // skip batch on error
        }
        if (i + batchSize < albumIds.length)
            await delay(300);
    }
    return coverMap;
}
/** GET with retry on 429 (up to 3 attempts). */
async function tidalGet(url, opts) {
    const maxRetries = 3;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await axios_1.default.get(url, opts);
        }
        catch (err) {
            if (axios_1.default.isAxiosError(err) &&
                err.response?.status === 429 &&
                attempt < maxRetries - 1) {
                const retryAfter = Number(err.response.headers["retry-after"]) || 2;
                await delay(retryAfter * 1000);
                continue;
            }
            throw err;
        }
    }
    throw new Error("unreachable");
}
async function fetchRelationshipItems(url, headers, countryCode) {
    const items = [];
    let next = `${url}?countryCode=${countryCode}`;
    while (next) {
        const res = await tidalGet(resolveUrl(next), { headers });
        if (Array.isArray(res.data.data)) {
            items.push(...res.data.data);
        }
        next = res.data.links?.next ?? null;
        if (next)
            await delay(200);
    }
    return items;
}
// ── Batch track fetch ──────────────────────────────────────────────
async function fetchTracksBatch(trackIds, headers, countryCode, apiBaseUrl) {
    const resources = [];
    const included = [];
    const batchSize = 20;
    for (let i = 0; i < trackIds.length; i += batchSize) {
        const batch = trackIds.slice(i, i + batchSize);
        const res = await tidalGet(`${apiBaseUrl}/tracks`, {
            headers,
            params: {
                countryCode,
                "filter[id]": batch.join(","),
                include: "artists,albums",
            },
        });
        const data = res.data.data;
        if (Array.isArray(data))
            resources.push(...data);
        else if (data)
            resources.push(data);
        if (res.data.included)
            included.push(...res.data.included);
        if (i + batchSize < trackIds.length)
            await delay(300);
    }
    return { resources, included };
}
// ── Public API ─────────────────────────────────────────────────────
async function getTidalPlaylist(playlistUrlOrId) {
    const playlistId = extractPlaylistId(playlistUrlOrId);
    const env = (0, env_1.getRequiredTidalEnv)();
    const accessToken = await resolveAccessToken(env);
    const headers = tidalHeaders(accessToken);
    // 1. Playlist metadata
    const playlistRes = await tidalGet(`${env.tidalApiBaseUrl}/playlists/${playlistId}`, { headers, params: { countryCode: env.tidalCountryCode } });
    const plRes = Array.isArray(playlistRes.data.data)
        ? playlistRes.data.data[0]
        : playlistRes.data.data;
    if (!plRes) {
        throw new Error("TIDAL playlist response did not include playlist data.");
    }
    const playlistName = getString(plRes.attributes?.title) ||
        getString(plRes.attributes?.name) ||
        `TIDAL playlist ${playlistId}`;
    // 2. Get playlist item identifiers (paginated JSON:API relationship)
    const itemRefs = await fetchRelationshipItems(`${env.tidalApiBaseUrl}/playlists/${playlistId}/relationships/items`, headers, env.tidalCountryCode);
    // Keep only tracks (skip videos)
    const trackIds = itemRefs.filter((r) => r.type === "tracks").map((r) => r.id);
    if (trackIds.length === 0) {
        return { id: playlistId, name: playlistName, tracks: [] };
    }
    // 3. Batch-fetch full track resources with included artists & albums
    const { resources, included } = await fetchTracksBatch(trackIds, headers, env.tidalCountryCode, env.tidalApiBaseUrl);
    // 4. Map to SourceTrack, preserving playlist order
    const trackMap = new Map(resources.map((r) => [r.id, r]));
    const tracks = [];
    for (const id of trackIds) {
        const resource = trackMap.get(id);
        if (resource) {
            const track = mapTrackResource(resource, included);
            if (track.title)
                tracks.push(track);
        }
    }
    // 5. Resolve cover art and track positions for tracks
    const albumIdsForCovers = new Set();
    for (const r of resources) {
        const refs = r.relationships?.albums?.data;
        const ref = Array.isArray(refs) ? refs[0] : refs;
        if (ref)
            albumIdsForCovers.add(ref.id);
    }
    if (albumIdsForCovers.size > 0) {
        const [coverMap, posMap] = await Promise.all([
            fetchAlbumCovers([...albumIdsForCovers], headers, env.tidalCountryCode, env.tidalApiBaseUrl),
            fetchAlbumTrackPositions([...albumIdsForCovers], headers, env.tidalCountryCode, env.tidalApiBaseUrl),
        ]);
        for (let i = 0; i < tracks.length; i++) {
            const resource = trackMap.get(trackIds[i]);
            const refs = resource?.relationships?.albums?.data;
            const ref = Array.isArray(refs) ? refs[0] : refs;
            if (ref) {
                if (!tracks[i].coverUrl && coverMap.has(ref.id)) {
                    tracks[i].coverUrl = coverMap.get(ref.id);
                }
                // Apply track/disc numbers from album relationship meta
                const pos = posMap.get(tracks[i].id);
                if (pos) {
                    if (!tracks[i].trackNumber && pos.trackNumber)
                        tracks[i].trackNumber = pos.trackNumber;
                    if (!tracks[i].discNumber && pos.discNumber)
                        tracks[i].discNumber = pos.discNumber;
                }
            }
        }
    }
    return { id: playlistId, name: playlistName, tracks };
}
async function getTidalAlbum(albumUrlOrId) {
    const albumId = extractAlbumId(albumUrlOrId);
    const env = (0, env_1.getRequiredTidalEnv)();
    const accessToken = await resolveAccessToken(env);
    const headers = tidalHeaders(accessToken);
    // 1. Album metadata (include coverArt to get artwork URLs)
    const albumRes = await tidalGet(`${env.tidalApiBaseUrl}/albums/${albumId}`, { headers, params: { countryCode: env.tidalCountryCode, include: "artists,coverArt" } });
    const alRes = Array.isArray(albumRes.data.data)
        ? albumRes.data.data[0]
        : albumRes.data.data;
    if (!alRes) {
        throw new Error("TIDAL album response did not include album data.");
    }
    const albumTitle = getString(alRes.attributes?.title) ||
        getString(alRes.attributes?.name) ||
        `TIDAL album ${albumId}`;
    // Resolve cover from included artworks
    let coverUrl;
    const coverRefs = alRes.relationships?.coverArt?.data;
    if (Array.isArray(coverRefs) && coverRefs.length > 0 && albumRes.data.included) {
        const artwork = albumRes.data.included.find((r) => r.type === coverRefs[0].type && r.id === coverRefs[0].id);
        if (artwork)
            coverUrl = extractArtworkUrl(artwork);
    }
    // Resolve artists from included
    let albumArtists = [];
    if (alRes.relationships?.artists && albumRes.data.included) {
        const refs = alRes.relationships.artists.data;
        if (Array.isArray(refs)) {
            albumArtists = refs
                .map((ref) => {
                const r = albumRes.data.included.find((i) => i.type === ref.type && i.id === ref.id);
                return getString(r?.attributes?.name);
            })
                .filter(Boolean);
        }
    }
    // Get album release year
    const albumYear = getString(alRes.attributes?.releaseDate).slice(0, 4) || undefined;
    // 2. Get album track identifiers (paginated relationship)
    const itemRefs = await fetchRelationshipItems(`${env.tidalApiBaseUrl}/albums/${albumId}/relationships/items`, headers, env.tidalCountryCode);
    const trackIds = itemRefs.filter((r) => r.type === "tracks").map((r) => r.id);
    if (trackIds.length === 0) {
        return { id: albumId, title: albumTitle, artists: albumArtists, year: albumYear, coverUrl, tracks: [] };
    }
    // 3. Batch-fetch tracks
    const { resources, included } = await fetchTracksBatch(trackIds, headers, env.tidalCountryCode, env.tidalApiBaseUrl);
    // 4. Map to SourceTrack, preserving album order
    const trackMap = new Map(resources.map((r) => [r.id, r]));
    const tracks = [];
    // Build a map of track ID -> relationship meta (trackNumber, volumeNumber)
    const itemMetaMap = new Map();
    for (const ref of itemRefs) {
        if (ref.meta)
            itemMetaMap.set(ref.id, ref.meta);
    }
    for (const id of trackIds) {
        const resource = trackMap.get(id);
        if (resource) {
            const track = mapTrackResource(resource, included);
            // Apply track/disc numbers from album relationship meta
            const meta = itemMetaMap.get(id);
            if (meta) {
                const tn = getNumber(meta.trackNumber);
                if (tn)
                    track.trackNumber = tn;
                const vn = getNumber(meta.volumeNumber);
                if (vn)
                    track.discNumber = vn;
            }
            // Apply album-level cover + year if track doesn't have its own
            if (!track.coverUrl && coverUrl)
                track.coverUrl = coverUrl;
            if (!track.year && albumYear)
                track.year = albumYear;
            if (track.title)
                tracks.push(track);
        }
    }
    return { id: albumId, title: albumTitle, artists: albumArtists, year: albumYear, coverUrl, tracks };
}
async function searchTidalArtists(query) {
    const env = (0, env_1.getRequiredTidalEnv)();
    const accessToken = await resolveAccessToken(env);
    const headers = tidalHeaders(accessToken);
    // Search for artists
    const searchRes = await tidalGet(`${env.tidalApiBaseUrl}/searchResults/${encodeURIComponent(query)}/relationships/artists`, { headers, params: { countryCode: env.tidalCountryCode, "page[limit]": 10 } });
    const artistRefs = searchRes.data.data;
    if (!Array.isArray(artistRefs) || artistRefs.length === 0)
        return [];
    const results = [];
    for (const ref of artistRefs.slice(0, 5)) {
        // Fetch artist details
        let artistName = "";
        let imageUrl;
        try {
            const artistRes = await tidalGet(`${env.tidalApiBaseUrl}/artists/${ref.id}`, { headers, params: { countryCode: env.tidalCountryCode } });
            const aData = Array.isArray(artistRes.data.data)
                ? artistRes.data.data[0]
                : artistRes.data.data;
            if (aData?.attributes) {
                artistName = getString(aData.attributes.name);
                imageUrl = getString(aData.attributes.imageUrl) || getString(aData.attributes.picture) || undefined;
            }
        }
        catch {
            continue;
        }
        if (!artistName)
            continue;
        // Fetch artist albums
        const albums = [];
        try {
            const albumRefs = await fetchRelationshipItems(`${env.tidalApiBaseUrl}/artists/${ref.id}/relationships/albums`, headers, env.tidalCountryCode);
            const albumIds = albumRefs.filter((r) => r.type === "albums").map((r) => r.id).slice(0, 20);
            // Batch-fetch albums
            for (let i = 0; i < albumIds.length; i += 10) {
                const batch = albumIds.slice(i, i + 10);
                try {
                    const res = await tidalGet(`${env.tidalApiBaseUrl}/albums`, {
                        headers,
                        params: {
                            countryCode: env.tidalCountryCode,
                            "filter[id]": batch.join(","),
                        },
                    });
                    const data = Array.isArray(res.data.data) ? res.data.data : res.data.data ? [res.data.data] : [];
                    for (const al of data) {
                        albums.push({
                            id: al.id,
                            title: getString(al.attributes?.title),
                            releaseDate: getString(al.attributes?.releaseDate) || undefined,
                            coverUrl: getString(al.attributes?.imageCover) || getString(al.attributes?.imageUrl) || undefined,
                            trackCount: typeof al.attributes?.numberOfItems === "number" ? al.attributes.numberOfItems
                                : typeof al.attributes?.numberOfTracks === "number" ? al.attributes.numberOfTracks
                                    : undefined,
                        });
                    }
                }
                catch {
                    // skip batch
                }
                if (i + 10 < albumIds.length)
                    await delay(300);
            }
        }
        catch {
            // artist with no albums is fine
        }
        results.push({ id: ref.id, name: artistName, imageUrl, albums });
        await delay(200);
    }
    return results;
}
