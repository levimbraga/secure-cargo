/**
 * The certificate as a PDF, made in the browser from the server's record (pdf-lib, standard
 * fonts, A4). Every string comes translated from the page; this file only lays them out.
 * Loaded on demand, when the user asks for the PDF.
 */
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

import { MARK_PATH, MARK_VIEWBOX } from "@/components/site/mark";

export interface CertificatePdfInput {
  id: string;
  verifyUrl: string;
  hash: string;
  title: string;
  label: string;
  stateLine: string;
  tone: "pass" | "warn";
  rows: [string, string][];
  /** The label of the row the truck drawing goes beside. */
  truckRow: string;
  situationsTitle: string;
  situations: { name: string; status: string; ok: boolean }[];
  checksTitle: string;
  checks: { name: string; article: string; status: string; ok: boolean | null }[];
  axlesTitle: string;
  axles: string[];
  hashLabel: string;
  scanLabel: string;
  disclaimer: string;
  photo: Uint8Array | null;
  truck: Uint8Array | null;
  warning: string | null;
}

const INK = rgb(0.098, 0.098, 0.094);
const GRAY = rgb(0.39, 0.39, 0.38);
const HAIRLINE = rgb(0.86, 0.86, 0.84);
const PASS = rgb(0.075, 0.435, 0.2);
const WARN = rgb(0.6, 0.38, 0.02);
const FAIL = rgb(0.706, 0.137, 0.094);

/** WinAnsi (the standard fonts' encoding) has no arrows and a few other signs: replace them. */
export function pdfSafe(text: string): string {
  const extras = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  return text
    .replace(/→/g, "->")
    .replace(/≈/g, "~")
    .replace(/[   ]/g, " ")
    .replace(/./gu, (c) => (c.charCodeAt(0) <= 0xff || extras.includes(c) ? c : "?"));
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of pdfSafe(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export async function certificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(input.title));
  doc.setSubject(pdfSafe(input.label));
  doc.setProducer("SecureCargo");
  doc.setCreator("SecureCargo");
  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const left = 48;
  const right = 595.28 - 48;
  let y = 841.89 - 56;

  const text = (p: PDFPage, value: string, x: number, at: number, size: number, font = regular, color = INK) =>
    p.drawText(pdfSafe(value), { x, y: at, size, font, color });

  // Header: the mark (12 pt square, top at the cap height) and the wordmark
  const markSize = 12;
  const markScale = markSize / MARK_VIEWBOX.size;
  page.drawSvgPath(MARK_PATH, {
    x: left - MARK_VIEWBOX.x * markScale,
    y: y + 9.5 + MARK_VIEWBOX.y * markScale,
    scale: markScale,
    color: INK,
  });
  text(page, "SecureCargo", left + markSize + 5, y, 11, bold);
  text(page, input.label.toUpperCase(), right - regular.widthOfTextAtSize(pdfSafe(input.label.toUpperCase()), 8), y + 1, 8, regular, GRAY);
  y -= 34;
  text(page, input.title, left, y, 20, bold);
  y -= 22;
  text(page, input.stateLine, left, y, 12, bold, input.tone === "pass" ? PASS : WARN);
  if (input.warning) {
    y -= 18;
    text(page, input.warning, left, y, 10, bold, FAIL);
  }
  y -= 20;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.6, color: HAIRLINE });

  // Photo (left) and QR (right)
  const top = y - 14;
  const qrSize = 118;
  const qr = QRCode.create(input.verifyUrl, { errorCorrectionLevel: "M" });
  const cells = qr.modules.size;
  const cell = qrSize / (cells + 2);
  const qrX = right - qrSize;
  const qrY = top - qrSize;
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      if (qr.modules.get(r, c)) {
        page.drawRectangle({ x: qrX + (c + 1) * cell, y: qrY + qrSize - (r + 2) * cell, width: cell + 0.05, height: cell + 0.05, color: INK });
      }
    }
  }
  text(page, input.scanLabel, qrX, qrY - 12, 8, regular, GRAY);
  // The link under the QR, on one line: as large as fits between the QR's left edge and the margin.
  const link = pdfSafe(input.verifyUrl.replace(/^https:\/\//, ""));
  const linkSize = Math.min(8, (8 * qrSize) / regular.widthOfTextAtSize(link, 8));
  text(page, link, qrX, qrY - 23, linkSize);

  let photoBottom = top;
  if (input.photo) {
    const isPng = input.photo[0] === 0x89 && input.photo[1] === 0x50;
    const image = isPng ? await doc.embedPng(input.photo) : await doc.embedJpg(input.photo);
    const maxW = qrX - left - 24;
    const maxH = 170;
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { x: left, y: top - h, width: w, height: h });
    photoBottom = top - h;
  }
  y = Math.min(photoBottom, qrY - 40) - 22;

  // Facts
  const labelWidth = 120;
  const truckImage = input.truck ? await doc.embedPng(input.truck) : null;
  for (const [label, value] of input.rows) {
    const withTruck = truckImage && label === input.truckRow;
    text(page, label, left, y, 9, regular, GRAY);
    const lines = wrap(value, regular, 10, right - left - labelWidth - (withTruck ? 130 : 0));
    lines.forEach((line, n) => text(page, line, left + labelWidth, y - n * 12, 10));
    if (withTruck) {
      const h = 16;
      const w = (truckImage.width / truckImage.height) * h;
      page.drawImage(truckImage, { x: right - w, y: y - 3, width: w, height: h });
    }
    y -= Math.max(1, lines.length) * 12 + 6;
  }
  y -= 8;

  // Situations and checks, side by side
  const colW = (right - left - 24) / 2;
  const startY = y;
  text(page, input.situationsTitle.toUpperCase(), left, y, 8, bold, GRAY);
  y -= 15;
  for (const s of input.situations) {
    text(page, s.name, left, y, 9.5);
    const status = pdfSafe(s.status);
    text(page, status, left + colW - bold.widthOfTextAtSize(status, 9.5), y, 9.5, bold, s.ok ? PASS : FAIL);
    y -= 13;
  }
  let y2 = startY;
  const x2 = left + colW + 24;
  text(page, input.checksTitle.toUpperCase(), x2, y2, 8, bold, GRAY);
  y2 -= 15;
  for (const c of input.checks) {
    const status = pdfSafe(c.status);
    const nameW = colW - bold.widthOfTextAtSize(status, 9.5) - 8;
    const lines = wrap(`${c.name}${c.article ? ` (${c.article})` : ""}`, regular, 9.5, nameW);
    lines.forEach((line, n) => text(page, line, x2, y2 - n * 11.5, 9.5));
    text(page, status, x2 + colW - bold.widthOfTextAtSize(status, 9.5), y2, 9.5, bold, c.ok === null ? GRAY : c.ok ? PASS : FAIL);
    y2 -= lines.length * 11.5 + 2;
  }
  y = Math.min(y, y2) - 10;

  if (input.axles.length) {
    text(page, input.axlesTitle.toUpperCase(), left, y, 8, bold, GRAY);
    y -= 14;
    text(page, input.axles.join("   ·   "), left, y, 9.5);
    y -= 20;
  }

  // Hash and disclaimer at the foot of the page
  const foot = 48;
  const disclaimer = wrap(input.disclaimer, regular, 8, right - left);
  let fy = foot + disclaimer.length * 10 + 30;
  page.drawLine({ start: { x: left, y: fy + 14 }, end: { x: right, y: fy + 14 }, thickness: 0.6, color: HAIRLINE });
  text(page, input.hashLabel, left, fy, 8, regular, GRAY);
  text(page, input.hash, left, fy - 12, 7.6, mono);
  fy -= 30;
  disclaimer.forEach((line, n) => text(page, line, left, fy - n * 10, 8, regular, GRAY));

  return doc.save();
}

/** Our truck drawing (an SVG on the page) as a PNG for the PDF, in ink on white. */
export async function svgToPng(svg: SVGSVGElement, scale = 4): Promise<Uint8Array | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.style.color = "#191918";
  const box = svg.viewBox.baseVal;
  const width = (box?.width || svg.clientWidth || 200) * scale;
  const height = (box?.height || svg.clientHeight || 64) * scale;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const source = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, "#191918");
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("svg"));
    image.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
