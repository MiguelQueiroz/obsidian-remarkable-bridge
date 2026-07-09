/*
 * Bake reMarkable ink onto PDF pages using pdf-lib.
 *
 * The device renders a PDF fit-to-width in its page coordinate space (x
 * centered on 0, y downward from the top). We map that space onto each PDF
 * page. Normal pens are drawn segment by segment with per-point width, so
 * pressure variation survives; highlighters are a single translucent
 * round-capped path with multiply blending.
 *
 * Pen calibration (colors, opacities, width factor) follows the values
 * established by the reMarkable Sync plugin (GPL-3.0, Tim Dommett /
 * KeyStone), which were tuned against reference sheets.
 */

import { PDFDocument, PDFPage, LineCapStyle, rgb, BlendMode } from "pdf-lib";
import { Stroke } from "./rm/codec";

const Pen = {
  BRUSH: 0,
  PENCIL_1: 1,
  BALLPOINT_1: 2,
  MARKER_1: 3,
  FINELINER_1: 4,
  HIGHLIGHTER_1: 5,
  ERASER: 6,
  MECHANICAL_PENCIL_1: 7,
  ERASER_AREA: 8,
  PAINTBRUSH_2: 12,
  MECHANICAL_PENCIL_2: 13,
  PENCIL_2: 14,
  BALLPOINT_2: 15,
  MARKER_2: 16,
  FINELINER_2: 17,
  HIGHLIGHTER_2: 18,
  CALLIGRAPHY: 21,
  SHADER: 23,
} as const;

const PEN_STYLES: Record<number, { opacity: number; isHighlighter: boolean }> = {
  [Pen.BRUSH]: { opacity: 1, isHighlighter: false },
  [Pen.PENCIL_1]: { opacity: 0.35, isHighlighter: false },
  [Pen.PENCIL_2]: { opacity: 0.35, isHighlighter: false },
  [Pen.BALLPOINT_1]: { opacity: 1, isHighlighter: false },
  [Pen.BALLPOINT_2]: { opacity: 1, isHighlighter: false },
  [Pen.MARKER_1]: { opacity: 1, isHighlighter: false },
  [Pen.MARKER_2]: { opacity: 1, isHighlighter: false },
  [Pen.FINELINER_1]: { opacity: 1, isHighlighter: false },
  [Pen.FINELINER_2]: { opacity: 1, isHighlighter: false },
  [Pen.MECHANICAL_PENCIL_1]: { opacity: 0.7, isHighlighter: false },
  [Pen.MECHANICAL_PENCIL_2]: { opacity: 0.7, isHighlighter: false },
  [Pen.PAINTBRUSH_2]: { opacity: 1, isHighlighter: false },
  [Pen.CALLIGRAPHY]: { opacity: 1, isHighlighter: false },
  [Pen.HIGHLIGHTER_1]: { opacity: 0.45, isHighlighter: true },
  [Pen.HIGHLIGHTER_2]: { opacity: 0.45, isHighlighter: true },
  [Pen.SHADER]: { opacity: 0.3, isHighlighter: true },
};

const COLOR_MAP: Record<number, [number, number, number]> = {
  0: [0, 0, 0],
  1: [0.5647, 0.5647, 0.5647],
  2: [1, 1, 1],
  3: [0.9804, 0.9059, 0.098],
  4: [0.5686, 0.8549, 0.4431],
  5: [0.7529, 0.498, 0.8235],
  6: [0.1882, 0.2902, 0.8784],
  7: [0.7608, 0.1922, 0.1961],
  8: [0.5647, 0.5647, 0.5647],
  9: [0.9804, 0.9059, 0.098],
  10: [0.5686, 0.8549, 0.4431],
  11: [0.4549, 0.8235, 0.9098],
  12: [0.7529, 0.498, 0.8235],
  13: [0.9804, 0.9059, 0.098],
};

/** Calibrated raw-point-width to rm-unit factor. */
const WIDTH_FACTOR = 0.216;

export interface PageInk {
  /** 0-based page index in the base PDF. */
  pdfPageIndex: number;
  strokes: Stroke[];
  /** Device page size in rm units, from the page's SceneInfo when present. */
  paperSize: [number, number] | null;
}

function strokeColor(stroke: Stroke): { r: number; g: number; b: number; a: number } {
  if (stroke.colorRgba) {
    const [r, g, b, a] = stroke.colorRgba;
    return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
  }
  const [r, g, b] = COLOR_MAP[stroke.color] ?? COLOR_MAP[0];
  return { r, g, b, a: 1 };
}

/** Device page width in rm units: SceneInfo when present, else inferred. */
function rmWidth(paperSize: [number, number] | null, strokes: Stroke[]): number {
  if (paperSize) return paperSize[0];
  let maxAbsX = 0;
  for (const s of strokes) for (const p of s.points) maxAbsX = Math.max(maxAbsX, Math.abs(p.x));
  // Old geometry is 1404 wide (|x| <= 702); Paper Pro is 1620.
  return maxAbsX > 720 ? 1620 : 1404;
}

function drawStroke(page: PDFPage, stroke: Stroke, scale: number, halfW: number, pdfH: number) {
  const style = PEN_STYLES[stroke.tool] ?? { opacity: 1, isHighlighter: false };
  const color = strokeColor(stroke);
  let opacity = style.opacity;
  if (stroke.tool === Pen.SHADER && stroke.colorRgba) opacity = color.a;

  const toX = (x: number) => (x + halfW) * scale;
  const toY = (y: number) => pdfH - y * scale;
  const border = rgb(color.r, color.g, color.b);

  if (style.isHighlighter) {
    const widths = stroke.points.map((p) => p.width).sort((a, b) => a - b);
    const median = widths[Math.floor(widths.length / 2)] || 8;
    const d = stroke.points
      .map((p, i) => `${i === 0 ? "M" : "L"}${toX(p.x).toFixed(2)},${(p.y * scale).toFixed(2)}`)
      .join(" ");
    page.drawSvgPath(d, {
      x: 0,
      y: pdfH,
      borderColor: border,
      borderWidth: Math.max(0.4, median * WIDTH_FACTOR * scale),
      borderOpacity: opacity,
      borderLineCap: LineCapStyle.Round,
      blendMode: BlendMode.Multiply,
    });
    return;
  }

  // Normal pens: per-segment width preserves pressure variation.
  for (let i = 1; i < stroke.points.length; i++) {
    const prev = stroke.points[i - 1];
    const curr = stroke.points[i];
    page.drawLine({
      start: { x: toX(prev.x), y: toY(prev.y) },
      end: { x: toX(curr.x), y: toY(curr.y) },
      thickness: Math.max(0.3, curr.width * WIDTH_FACTOR * scale),
      color: border,
      opacity,
      lineCap: LineCapStyle.Round,
    });
  }
}

export async function bakeInkOntoPdf(pdfBytes: Uint8Array, ink: PageInk[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();

  for (const { pdfPageIndex, strokes, paperSize } of ink) {
    const page = pages[pdfPageIndex];
    if (!page || !strokes.length) continue;
    const { width: pdfW, height: pdfH } = page.getSize();
    const rmW = rmWidth(paperSize, strokes);
    const scale = pdfW / rmW;

    for (const stroke of strokes) {
      if (stroke.tool === Pen.ERASER || stroke.tool === Pen.ERASER_AREA) continue;
      if (stroke.points.length < 2) continue;
      drawStroke(page, stroke, scale, rmW / 2, pdfH);
    }
  }
  return doc.save({ useObjectStreams: true });
}
