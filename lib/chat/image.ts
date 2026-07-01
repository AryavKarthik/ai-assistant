export const ALLOWED_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type AllowedImageMediaType = (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface EphemeralImage {
  mediaType: AllowedImageMediaType;
  data: string;
}

export function isAllowedImageMediaType(
  value: string,
): value is AllowedImageMediaType {
  return (ALLOWED_IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

export function parseEphemeralImage(
  value: unknown,
): { image: EphemeralImage } | { error: string } {
  if (!value || typeof value !== "object") {
    return { error: "image must be an object" };
  }

  const candidate = value as { mediaType?: unknown; data?: unknown };
  const mediaType =
    typeof candidate.mediaType === "string" ? candidate.mediaType : "";
  const data = typeof candidate.data === "string" ? candidate.data.trim() : "";

  if (!isAllowedImageMediaType(mediaType)) {
    return { error: "image.mediaType must be jpeg, png, gif, or webp" };
  }

  if (!data) {
    return { error: "image.data is required" };
  }

  if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) {
    return { error: "image.data must be valid base64" };
  }

  const normalizedData = data.replace(/\s/g, "");
  let byteLength = 0;
  try {
    byteLength = Buffer.from(normalizedData, "base64").byteLength;
  } catch {
    return { error: "image.data must be valid base64" };
  }

  if (byteLength === 0) {
    return { error: "image.data must not be empty" };
  }

  if (byteLength > MAX_IMAGE_BYTES) {
    return { error: "image must be 5 MB or smaller" };
  }

  return {
    image: {
      mediaType,
      data: normalizedData,
    },
  };
}

export function persistedMessageText(message: string, hasImage: boolean): string {
  const trimmed = message.trim();
  if (trimmed) return trimmed;
  if (hasImage) return "[Image attached]";
  return "";
}
