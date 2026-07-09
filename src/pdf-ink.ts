/*
 * Bake reMarkable ink onto PDF pages using pdf-lib.
 *
 * The device renders a PDF fit-to-width in its page coordinate space (x
 * centered on 0, y downward from the top). We map that space onto each PDF
 * page and draw strokes as round-capped polylines. Highlighter strokes are
 * drawn translucent; everything else opaque. This is a faithful-position,
 * simplified-texture rendering, not a brush simulation.
 */

import { PDFDocument, LineCapStyle, rgb, BlendMode } from "pdf-lib";
import { Stroke } from "./rm/codec";

const HIGHLIGHTER_TOOLS = new Set([5, 18]);
// Marker/pen color ids -> RGB. colorRgba on the stroke wins when present.
const COLOR_MAP: Record<number, [number, number, number]> = {
  0: [0, 0, 0],
  1: [125, 125, 125],
  2: [255, 255, 255],
  3: [255, 235, 90],
  4: [125, 184, 45],
  5: [255, 120, 180],
  6: [45, 100, 235],
  7: [217, 52, 41],
  8: [125, 125, 125],
  9: [255, 237, 117],
};

export interface PageInk {
  /** 0-based page index in the base PDF. */
  pdfPageIndex: number;
  strokes: Stroke[];
  /** Device page width in rm units; defaults to reMarkable 2 geometry. */
  paperSize: [number, number] | null;
}

export async function bakeInkOntoPdf(pdfBytes: Uint8Array, ink: PageInk[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();

  for (const { pdfPageIndex, strokes, paperSize } of ink) {
    const page = pages[pdfPageIndex];
    if (!page || !strokes.length) continue;
    const { width: pdfW, height: pdfH } = page.getSize();
    const [rmW] = paperSize ?? [1404, 1872];
    const scale = pdfW / rmW;

    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      const [r0, g0, b0] = stroke.colorRgba
        ? [stroke.colorRgba[0], stroke.colorRgba[1], stroke.colorRgba[2]]
        : COLOR_MAP[stroke.color] ?? [0, 0, 0];
      const isHighlighter = HIGHLIGHTER_TOOLS.has(stroke.tool);
      const widths = stroke.points.map((p) => p.width).sort((a, b) => a - b);
      const median = widths[Math.floor(widths.length / 2)] || 8;
      const lineWidth = Math.max(0.4, (median / 4) * scale);

      const d = stroke.points
        .map((p, i) => `${i === 0 ? "M" : "L"}${((p.x + rmW / 2) * scale).toFixed(2)},${(p.y * scale).toFixed(2)}`)
        .join(" ");
      page.drawSvgPath(d, {
        x: 0,
        y: pdfH,
        borderColor: rgb(r0 / 255, g0 / 255, b0 / 255),
        borderWidth: lineWidth,
        borderOpacity: isHighlighter ? 0.45 : 1,
        borderLineCap: LineCapStyle.Round,
        blendMode: isHighlighter ? BlendMode.Multiply : BlendMode.Normal,
      });
    }
  }
  return doc.save({ useObjectStreams: true });
}
