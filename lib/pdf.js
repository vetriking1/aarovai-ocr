import * as mupdf from "mupdf";
import fs from "fs";
import path from "path";
import { MAX_PAGES_LIMIT } from "../config/constants.js";

/**
 * Checks if a buffer begins with PDF magic bytes (%PDF)
 */
export function isPdfBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return buffer.subarray(0, 4).toString("ascii") === "%PDF";
}

/**
 * Opens a PDF document reference using MuPDF WebAssembly engine
 * @param {Buffer|Uint8Array} pdfBuffer
 */
export function openPdfDocument(pdfBuffer) {
  try {
    return mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  } catch (err) {
    const error = new Error(`Invalid or corrupt PDF document: ${err.message}`);
    error.status = 400;
    throw error;
  }
}

/**
 * Validates PDF page count against safety guardrails (max 60 pages)
 */
export function validatePdfDocument(doc, maxPages = MAX_PAGES_LIMIT) {
  const pageCount = doc.countPages();
  if (pageCount === 0) {
    const err = new Error("The uploaded PDF has 0 pages.");
    err.status = 400;
    throw err;
  }
  if (pageCount > maxPages) {
    const err = new Error(
      `PDF contains ${pageCount} pages, which exceeds the maximum batch limit of ${maxPages} pages. Please split your document into smaller batches.`
    );
    err.status = 400;
    throw err;
  }
  return pageCount;
}

/**
 * On-Demand (Lazy) Page Renderer:
 * Renders ONLY the requested page index to a PNG Base64 data URL.
 * Immediately destroys the MuPDF pixmap pointer to keep memory minimal.
 *
 * @param {mupdf.Document} doc Open document reference
 * @param {number} pageIndex 0-based page index
 * @param {number} scale DPI scaling factor (default 2.0 = ~150-200 DPI)
 * @returns {string} Data URL string (data:image/png;base64,...)
 */
export function renderPageToDataUrl(doc, pageIndex, scale = 2.0) {
  const page = doc.loadPage(pageIndex);
  const transform = mupdf.Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(transform, mupdf.ColorSpace.DeviceRGB, false, true);
  const pngBase64 = Buffer.from(pixmap.asPNG()).toString("base64");

  return `data:image/png;base64,${pngBase64}`;
}

/**
 * Converts a static image file path to base64 data URL
 */
export function fileToDataUrl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at path: ${filePath}`);
  }
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mime = mimeMap[ext] || "image/jpeg";
  const base64Data = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${base64Data}`;
}

/**
 * Normalizes input image string into a valid data URL
 */
export function normalizeImageUrl(imageInput) {
  if (!imageInput) return null;
  const trimmed = imageInput.trim();
  if (
    trimmed.startsWith("data:") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://")
  ) {
    return trimmed;
  }
  return `data:image/jpeg;base64,${trimmed}`;
}
