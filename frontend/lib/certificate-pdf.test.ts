import { writeFileSync } from "node:fs";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { certificatePdf, type CertificatePdfInput } from "@/lib/certificate-pdf";

const input: CertificatePdfInput = {
  id: "test-id",
  verifyUrl: "https://securecargo.app/verify/test-id",
  hash: "0".repeat(64),
  title: "Load certificate",
  label: "Certificate",
  stateLine: "Approved: arrives intact and complies",
  tone: "pass",
  rows: [["Truck", "Toco, box truck"]],
  truckRow: "Truck",
  situationsTitle: "Trip physics",
  situations: [{ name: "Emergency braking", status: "Holds", ok: true }],
  checksTitle: "Rules",
  checks: [{ name: "Safety factor", article: "Art. 4", status: "Passes", ok: true }],
  axlesTitle: "Axles",
  axles: ["Front axle 5,200 kg"],
  hashLabel: "Hash",
  scanLabel: "Scan to verify",
  disclaimer: "Decision support, not an engineering certification.",
  photo: null,
  truck: null,
  warning: null,
};

describe("certificatePdf", () => {
  it("builds a one-page A4 PDF with the mark in the header", async () => {
    const bytes = await certificatePdf(input);
    if (process.env.CERTIFICATE_PDF_OUT) writeFileSync(process.env.CERTIFICATE_PDF_OUT, bytes);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
  });
});
