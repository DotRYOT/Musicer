"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeTags = writeTags;
const node_id3_1 = __importDefault(require("node-id3"));
const axios_1 = __importDefault(require("axios"));
async function fetchCover(url) {
    try {
        const res = await axios_1.default.get(url, {
            responseType: "arraybuffer",
            timeout: 15_000,
        });
        return Buffer.from(res.data);
    }
    catch {
        return null;
    }
}
async function writeTags(filePath, tags) {
    const id3Tags = {
        title: tags.title,
        artist: tags.artists.join(", "),
        album: tags.album,
        performerInfo: tags.albumArtist || tags.artists.join("/"),
        trackNumber: tags.trackNumber ? String(tags.trackNumber) : undefined,
        partOfSet: tags.discNumber ? String(tags.discNumber) : undefined,
        year: tags.year || undefined,
    };
    if (tags.coverUrl) {
        const coverData = await fetchCover(tags.coverUrl);
        if (coverData) {
            id3Tags.image = {
                mime: "image/jpeg",
                type: { id: 3, name: "front cover" },
                description: "Cover",
                imageBuffer: coverData,
            };
        }
    }
    const ok = node_id3_1.default.update(id3Tags, filePath);
    if (ok !== true) {
        throw new Error(`Failed to write ID3 tags to ${filePath}`);
    }
}
