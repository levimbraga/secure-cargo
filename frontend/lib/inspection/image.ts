/**
 * Photos are prepared in the browser before they leave the phone: decoded (HEIC too), turned
 * upright, scaled so the long edge is at most 1568 px (what the vision model uses; anything
 * larger is only bytes) and re-encoded as JPEG. Re-encoding on a canvas drops every piece of
 * metadata, GPS included; the server strips it again anyway.
 */

export const MAX_EDGE_PX = 1568;
const QUALITY = 0.85;

export class PhotoError extends Error {
  constructor(readonly code: "unsupported" | "too_small") {
    super(code);
  }
}

function isHeic(file: File): boolean {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

/** The size a photo is scaled to: the same aspect ratio, long edge at most `max`. */
export function scaledSize(width: number, height: number, max = MAX_EDGE_PX): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

/** A JPEG ready to upload, without metadata, and its size. */
export async function preparePhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await decode(file);
  } catch {
    // Most browsers other than Safari cannot decode HEIC: convert it first (loaded only then).
    if (!isHeic(file)) throw new PhotoError("unsupported");
    try {
      const { default: heic2any } = await import("heic2any");
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: QUALITY });
      bitmap = await decode(Array.isArray(converted) ? (converted[0] as Blob) : converted);
    } catch {
      throw new PhotoError("unsupported");
    }
  }
  if (Math.min(bitmap.width, bitmap.height) < 200) throw new PhotoError("too_small");
  const { width, height } = scaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new PhotoError("unsupported");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) throw new PhotoError("unsupported");
  return { blob, width, height };
}
