import NodeID3 from "node-id3";
import axios from "axios";

export interface TagPayload {
  title: string;
  artists: string[];
  album: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  year?: string;
  coverUrl?: string;
}

async function fetchCover(url: string): Promise<Buffer | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 15_000,
    });
    return Buffer.from(res.data);
  } catch {
    return null;
  }
}

export async function writeTags(filePath: string, tags: TagPayload): Promise<void> {
  const id3Tags: NodeID3.Tags = {
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

  const ok = NodeID3.update(id3Tags, filePath);
  if (ok !== true) {
    throw new Error(`Failed to write ID3 tags to ${filePath}`);
  }
}
