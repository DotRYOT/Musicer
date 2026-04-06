export type SourcePlatform = "tidal";

export interface SourceTrack {
  id: string;
  title: string;
  artists: string[];
  album: string;
  albumArtists?: string[];
  durationMs: number;
  trackNumber?: number;
  discNumber?: number;
  year?: string;
  isrc?: string;
  coverUrl?: string;
}

export interface SourcePlaylist {
  id: string;
  name: string;
  tracks: SourceTrack[];
}

export interface SourceAlbum {
  id: string;
  title: string;
  artists: string[];
  year?: string;
  coverUrl?: string;
  tracks: SourceTrack[];
}

export interface ArtistSearchResult {
  id: string;
  name: string;
  imageUrl?: string;
  albums: ArtistAlbumSummary[];
}

export interface ArtistAlbumSummary {
  id: string;
  title: string;
  releaseDate?: string;
  coverUrl?: string;
  trackCount?: number;
}

export interface RuntimeDependencyStatus {
  ytDlpAvailable: boolean;
  ffmpegAvailable: boolean;
}
