import { describe, expect, it, spyOn } from "bun:test";
import { cacheGoogleAvatar } from "../service/admin-avatar-service";

describe("cacheGoogleAvatar", () => {
  it("returns nulls without fetching when there is no Google avatar", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");

    const result = await cacheGoogleAvatar("admin-1", null, null, null);

    expect(result).toEqual({ avatarUrl: null, objectKey: null });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("skips re-downloading when the Google URL is unchanged and already cached", async () => {
    const fetchSpy = spyOn(globalThis, "fetch");

    const result = await cacheGoogleAvatar(
      "admin-1",
      "https://lh3.googleusercontent.com/a/unchanged",
      "https://lh3.googleusercontent.com/a/unchanged",
      "admin-avatars/admin-1/existing.avif",
    );

    expect(result).toEqual({
      avatarUrl: "https://lh3.googleusercontent.com/a/unchanged",
      objectKey: "admin-avatars/admin-1/existing.avif",
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("falls back to the raw URL without throwing when the download fails", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("network unreachable"),
    );

    const result = await cacheGoogleAvatar(
      "admin-1",
      "https://lh3.googleusercontent.com/a/new-photo",
      "https://lh3.googleusercontent.com/a/old-photo",
      "admin-avatars/admin-1/old.avif",
    );

    expect(result).toEqual({
      avatarUrl: "https://lh3.googleusercontent.com/a/new-photo",
      objectKey: "admin-avatars/admin-1/old.avif",
    });

    fetchSpy.mockRestore();
  });
});
