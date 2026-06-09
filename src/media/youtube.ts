const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export type ParsedYouTubeSource = {
  normalizedUrl: string;
  provider: "youtube";
  thumbnailUrl: string;
  videoId: string;
};

function getVideoIdFromPath(url: URL): string | null {
  const pathSegments = url.pathname.split("/").filter(Boolean);

  if (url.hostname === "youtu.be") {
    return pathSegments[0] ?? null;
  }

  if (["embed", "live", "shorts"].includes(pathSegments[0] ?? "")) {
    return pathSegments[1] ?? null;
  }

  return url.searchParams.get("v");
}

function isYouTubeHost(hostname: string) {
  return [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be"
  ].includes(hostname);
}

export function parseYouTubeSource(sourceUrl: string): ParsedYouTubeSource | null {
  const trimmedUrl = sourceUrl.trim();

  if (!trimmedUrl) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(trimmedUrl);
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(url.protocol) || !isYouTubeHost(url.hostname)) {
    return null;
  }

  const videoId = getVideoIdFromPath(url);

  if (!videoId || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }

  return {
    normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
    provider: "youtube",
    thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    videoId
  };
}
