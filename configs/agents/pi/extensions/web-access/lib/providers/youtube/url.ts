const YOUTUBE_REGEX =
  /(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

export function isYouTubeUrl(url: string): { isYouTube: boolean; videoId: string | null } {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/playlist") return { isYouTube: false, videoId: null };
  } catch {}
  const match = url.match(YOUTUBE_REGEX);
  return match ? { isYouTube: true, videoId: match[1] } : { isYouTube: false, videoId: null };
}
