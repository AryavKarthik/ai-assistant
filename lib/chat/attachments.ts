import {
  ALLOWED_IMAGE_MEDIA_TYPES,
  MAX_IMAGE_BYTES,
  type AllowedImageMediaType,
} from "@/lib/chat/image";
import type { ChatImageAttachment } from "@/lib/chat/types";

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read image"));
      }
    };
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

export function toAttachment(file: File, dataUrl: string): ChatImageAttachment {
  return {
    mediaType: file.type as AllowedImageMediaType,
    data: dataUrl.split(",")[1] ?? "",
    previewUrl: dataUrl,
  };
}

export async function readImageAttachment(
  file: File,
): Promise<{ attachment: ChatImageAttachment } | { error: string }> {
  if (!(ALLOWED_IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type)) {
    return { error: "Only JPEG, PNG, GIF, and WebP images are supported." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: "Image must be 5 MB or smaller." };
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    return { attachment: toAttachment(file, dataUrl) };
  } catch {
    return { error: "Could not read that image." };
  }
}
