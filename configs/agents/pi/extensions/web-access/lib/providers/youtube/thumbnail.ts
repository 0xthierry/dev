export async function fetchYouTubeThumbnail(
  videoId: string,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const timeout = AbortSignal.timeout(5000);
    const effectiveSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, {
      signal: effectiveSignal,
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length > 0 ? { data: buffer.toString("base64"), mimeType: "image/jpeg" } : null;
  } catch {
    return null;
  }
}
