import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
  RGB,
} from 'pdf-lib';
import { Transaction } from '../types';
import { formatNaira } from './format';
import { collectReceiptRows, ReceiptRow, ReceiptTextMeta } from './receipt';

// A4 portrait (points: 1/72 inch).
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 48;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const HEADER_H = 150;
const LINE_H = 14;

// Mirrors the on-screen palette (constants/theme.ts).
const PRIMARY = rgb(37 / 255, 99 / 255, 235 / 255);
const PRIMARY_DARK = rgb(29 / 255, 78 / 255, 216 / 255);
const TEXT = rgb(15 / 255, 23 / 255, 42 / 255);
const TEXT_MUTED = rgb(100 / 255, 116 / 255, 139 / 255);
const BORDER = rgb(226 / 255, 232 / 255, 240 / 255);
const WHITE: RGB = rgb(1, 1, 1);
const SUCCESS = rgb(22 / 255, 163 / 255, 74 / 255);
const WARNING = rgb(217 / 255, 119 / 255, 6 / 255);
const DANGER = rgb(220 / 255, 38 / 255, 38 / 255);

/**
 * pdf-lib's built-in Helvetica cannot render the naira glyph, so money in the
 * PDF uses the "NGN" ISO prefix (the on-screen receipt keeps ₦).
 */
function pdfText(text: string): string {
  return text.replace(/₦/g, 'NGN ');
}

interface Pager {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  txn: Transaction;
  page: PDFPage;
  /** Current drawing cursor (top of the remaining content area). */
  y: number;
}

/** Word-wraps `text` to `maxWidth`, hard-splitting unbroken tokens (PINs, references). */
function splitLines(font: PDFFont, text: string, maxWidth: number, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (font.widthOfTextAtSize(word, size) > maxWidth) {
      // Unbreakable token too wide — hard-split it char by char.
      if (current) {
        lines.push(current);
        current = '';
      }
      let rest = word;
      while (rest.length) {
        let cut = rest.length;
        while (cut > 0 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
        if (cut === 0) cut = 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      continue;
    }
    const trial = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

function drawHeader(pager: Pager): void {
  const page = pager.page;
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: PRIMARY });

  // Brand badge (white rounded square with the SmartCafe mark).
  const badgeR = 22;
  const badgeY = PAGE_H - 44;
  page.drawRectangle({
    x: PAGE_W / 2 - badgeR,
    y: badgeY - badgeR,
    width: badgeR * 2,
    height: badgeR * 2,
    color: WHITE,
  });
  const mark = 'SC';
  const markSize = 13;
  const markW = pager.bold.widthOfTextAtSize(mark, markSize);
  page.drawText(mark, {
    x: PAGE_W / 2 - markW / 2,
    y: badgeY - markSize * 0.35,
    size: markSize,
    font: pager.bold,
    color: PRIMARY,
  });

  // App name.
  const appName = 'SmartCafe';
  const appSize = 22;
  const appW = pager.bold.widthOfTextAtSize(appName, appSize);
  page.drawText(appName, {
    x: PAGE_W / 2 - appW / 2,
    y: badgeY - 30,
    size: appSize,
    font: pager.bold,
    color: WHITE,
  });

  // Tagline.
  const tagline = 'Virtual Top-Up & Bills Payment';
  const tagSize = 9;
  const tagW = pager.regular.widthOfTextAtSize(tagline, tagSize);
  page.drawText(tagline, {
    x: PAGE_W / 2 - tagW / 2,
    y: badgeY - 46,
    size: tagSize,
    font: pager.regular,
    color: WHITE,
    opacity: 0.85,
  });

  // Status pill.
  const status =
    pager.txn.status === 'success'
      ? 'SUCCESSFUL'
      : pager.txn.status === 'pending'
        ? 'PROCESSING'
        : 'FAILED';
  const statusColor =
    pager.txn.status === 'success' ? SUCCESS : pager.txn.status === 'pending' ? WARNING : DANGER;
  const statusSize = 9;
  const padX = 10;
  const pillW = pager.bold.widthOfTextAtSize(status, statusSize) + padX * 2;
  const pillH = 18;
  const pillY = badgeY - 62;
  page.drawRectangle({
    x: PAGE_W / 2 - pillW / 2,
    y: pillY,
    width: pillW,
    height: pillH,
    color: statusColor,
  });
  page.drawText(status, {
    x: PAGE_W / 2 - pillW / 2 + padX,
    y: pillY + (pillH - statusSize) / 2,
    size: statusSize,
    font: pager.bold,
    color: WHITE,
  });

pager.y = PAGE_H - HEADER_H - 36;
}

/** Adds a page and redraws the brand header, resetting the cursor. */
function addPage(pager: Pager): void {
  pager.page = pager.doc.addPage([PAGE_W, PAGE_H]);
  drawHeader(pager);
}

/** Ensures at least `space` points are available below the cursor. */
function ensureSpace(pager: Pager, space: number): void {
  if (pager.y - space < 60) addPage(pager);
}

function drawDivider(pager: Pager): void {
  ensureSpace(pager, 24);
  pager.y -= 14;
  pager.page.drawLine({
    start: { x: MARGIN_X, y: pager.y },
    end: { x: MARGIN_X + CONTENT_W, y: pager.y },
    thickness: 1,
    color: BORDER,
    dashArray: [4, 3],
  });
  pager.y -= 10;
}

function drawRow(pager: Pager, row: ReceiptRow): void {
  const size = 9;
  const labelColMax = 130;

  const label = pdfText(row.label);
  const value = pdfText(row.value);

  const labelLines = splitLines(pager.regular, label, labelColMax, size);
  const labelColWidth = labelLines[0]
    ? Math.min(pager.regular.widthOfTextAtSize(labelLines[0], size), labelColMax)
    : 0;
  const valueMax = CONTENT_W - (label ? Math.max(70, labelColWidth) + 14 : 0);
  const valueLines = splitLines(row.strong ? pager.bold : pager.regular, value, valueMax, size);

  const lineCount = Math.max(labelLines.length, valueLines.length);
  const blockH = lineCount * LINE_H;

  ensureSpace(pager, blockH + 2);

  const baseY = pager.y;
  for (let i = 0; i < lineCount; i++) {
    const ly = baseY - i * LINE_H;
    const labelText = labelLines[i] ?? '';
    const valueText = valueLines[i] ?? '';
    if (labelText) {
      pager.page.drawText(labelText, {
        x: MARGIN_X,
        y: ly - size,
        size,
        font: pager.regular,
        color: TEXT_MUTED,
      });
    }
    const valueW = pager.bold.widthOfTextAtSize(valueText, size);
    pager.page.drawText(valueText, {
      x: MARGIN_X + CONTENT_W - valueW,
      y: ly - size,
      size,
      font: row.strong ? pager.bold : pager.regular,
      color: row.strong ? PRIMARY_DARK : TEXT,
    });
  }

  pager.y = baseY - blockH - 6;
}

function drawTotal(pager: Pager): void {
  const total = (pager.txn.amount ?? 0) + (pager.txn.commission ?? 0);
  ensureSpace(pager, 34);
  pager.y -= 16;
  const y = pager.y - 12;
  pager.page.drawText('TOTAL', {
    x: MARGIN_X,
    y,
    size: 13,
    font: pager.bold,
    color: TEXT,
  });
  const amountText = pdfText(formatNaira(total));
  const amountW = pager.bold.widthOfTextAtSize(amountText, 13);
  pager.page.drawText(amountText, {
    x: MARGIN_X + CONTENT_W - amountW,
    y,
    size: 13,
    font: pager.bold,
    color: PRIMARY,
  });
  pager.y -= 34;
}

function drawFooter(pager: Pager): void {
  const footer = 'Thank you for using SmartCafe.';
  const size = 9;
  const footerW = pager.regular.widthOfTextAtSize(footer, size);
  ensureSpace(pager, 24);
  pager.page.drawText(footer, {
    x: PAGE_W / 2 - footerW / 2,
    y: pager.y - 14,
    size,
    font: pager.regular,
    color: TEXT_MUTED,
  });
}

/**
 * Renders the standard SmartCafe receipt as a branded A4 PDF (same layout and
 * rows as the on-screen receipt). Pure pdf-lib — no React Native imports — so
 * it can run on device and in Node/web.
 */
export async function buildReceiptPdf(
  txn: Transaction,
  meta: ReceiptTextMeta = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pager: Pager = {
    doc,
    regular,
    bold,
    txn,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - HEADER_H - 36,
  };
  drawHeader(pager);

  const { main, provider } = collectReceiptRows(txn, meta);

  for (const row of main) drawRow(pager, row);
  if (provider.length) {
    drawDivider(pager);
    for (const row of provider) drawRow(pager, row);
  }
  drawDivider(pager);
  drawTotal(pager);
  drawFooter(pager);

  return doc.save();
}