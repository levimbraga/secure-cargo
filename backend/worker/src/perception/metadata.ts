/**
 * Remove metadata from an uploaded photo before it is stored: EXIF (camera, time and, above
 * all, GPS position), XMP, ICC-adjacent comments and text chunks.
 *
 * The page already re-encodes every photo on a canvas, which drops EXIF; this is the server's
 * own guarantee, so nothing with a location is ever written to the bucket.
 *
 * JPEG: every APP1..APP15 segment (EXIF, XMP, ...) and every comment (COM) before the image data
 * is dropped; APP0 (JFIF) and the coding segments stay. PNG: the eXIf, tEXt, zTXt, iTXt and
 * tIME chunks are dropped.
 */

export type ImageKind = "image/jpeg" | "image/png";

export class UnsupportedImage extends Error {}

export function imageKind(bytes: Uint8Array): ImageKind | null {
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (png.every((b, i) => bytes[i] === b)) return "image/png";
	return null;
}

export function stripMetadata(bytes: Uint8Array): { bytes: Uint8Array; kind: ImageKind } {
	const kind = imageKind(bytes);
	if (kind === "image/jpeg") return { bytes: stripJpeg(bytes), kind };
	if (kind === "image/png") return { bytes: stripPng(bytes), kind };
	throw new UnsupportedImage("Only JPEG and PNG photos are accepted.");
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
	const out: Uint8Array[] = [bytes.subarray(0, 2)];
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) throw new UnsupportedImage("Malformed JPEG.");
		const marker = bytes[offset + 1] as number;
		if (marker === 0xff) {
			offset += 1; // fill byte
			continue;
		}
		if (marker === 0xda) {
			// Start of scan: the entropy-coded data and everything after it stay as they are.
			out.push(bytes.subarray(offset));
			return concat(out);
		}
		const length = ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);
		if (length < 2 || offset + 2 + length > bytes.length) throw new UnsupportedImage("Malformed JPEG.");
		const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
		if (!metadata) out.push(bytes.subarray(offset, offset + 2 + length));
		offset += 2 + length;
	}
	throw new UnsupportedImage("Malformed JPEG.");
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(bytes: Uint8Array): Uint8Array {
	const out: Uint8Array[] = [bytes.subarray(0, 8)];
	let offset = 8;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	while (offset + 12 <= bytes.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		const end = offset + 12 + length;
		if (end > bytes.length) throw new UnsupportedImage("Malformed PNG.");
		if (!PNG_DROP.has(type)) out.push(bytes.subarray(offset, end));
		offset = end;
		if (type === "IEND") return concat(out);
	}
	throw new UnsupportedImage("Malformed PNG.");
}

function concat(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, p) => sum + p.length, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}
