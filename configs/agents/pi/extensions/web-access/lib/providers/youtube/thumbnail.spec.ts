import { describe, expect, test } from "bun:test";
import { fetchYouTubeThumbnail } from "./thumbnail";

describe("web-access YouTube live media contract", () => {
  test("fetches a YouTube thumbnail for a public video", async () => {
    const thumbnail = await fetchYouTubeThumbnail("dQw4w9WgXcQ");

    expect(thumbnail?.mimeType).toBe("image/jpeg");
    expect(thumbnail?.data.length ?? 0).toBeGreaterThan(1000);
  }, 30_000);
});
