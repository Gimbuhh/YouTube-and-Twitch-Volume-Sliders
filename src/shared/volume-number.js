export const VOLUME_NUMBER_FONT_FAMILY = '"Segoe UI", system-ui, sans-serif';
export const VOLUME_NUMBER_FONT_WEIGHT = 600;
export const VOLUME_NUMBER_FONT_SIZE = 16;
export const VOLUME_NUMBER_COMPACT_SIZE = 15;
export const VOLUME_NUMBER_COMPACT_SPACING = -0.25;
const COMPACT_MAX_WIDTH = 22.5;

export function createVolumeNumberRenderer(document, center) {
  let context;
  let pixelRatio;
  const positions = new Map();

  return (element, text) => {
    const compact = text.length > 2;
    const size = compact ? VOLUME_NUMBER_COMPACT_SIZE : VOLUME_NUMBER_FONT_SIZE;
    const ratio = document.defaultView?.devicePixelRatio || 1;
    if (ratio !== pixelRatio) {
      positions.clear();
      pixelRatio = ratio;
    }
    if (element.textContent !== text) {
      element.textContent = text;
    }
    element.toggleAttribute('data-compact', compact);

    if (context === undefined) {
      context = document.defaultView?.CanvasRenderingContext2D
        ? document.createElement('canvas').getContext('2d') : null;
    }
    if (!context) {
      return;
    }

    let position = positions.get(text);
    if (!position) {
      context.font = `${VOLUME_NUMBER_FONT_WEIGHT} ${size}px ${VOLUME_NUMBER_FONT_FAMILY}`;
      let metrics = context.measureText(text);
      const spacing = compact ? VOLUME_NUMBER_COMPACT_SPACING * (text.length - 1) : 0;
      const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight + spacing;
      let fittedSize = size;
      if (compact && width > COMPACT_MAX_WIDTH) {
        // Wider local fonts need a smaller 100, rather than compressed glyphs.
        fittedSize = Number((size * COMPACT_MAX_WIDTH / width).toFixed(3));
        context.font = `${VOLUME_NUMBER_FONT_WEIGHT} ${fittedSize}px ${VOLUME_NUMBER_FONT_FAMILY}`;
        metrics = context.measureText(text);
      }
      const { actualBoundingBoxLeft: left, actualBoundingBoxRight: right,
        actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent } = metrics;
      if (![left, right, ascent, descent].every(Number.isFinite) || left + right <= 0 || ascent + descent <= 0) {
        return;
      }
      // SVG tracking moves each following digit; preserve the glyphs' natural proportions.
      position = {
        x: center + (left - right - spacing) / 2,
        y: center + (ascent - descent) / 2,
        fontSize: fittedSize
      };
      positions.set(text, position);
    }
    // Alphabetic placement centers the painted glyphs, independent of font line-box metrics.
    element.setAttribute('text-anchor', 'start');
    element.setAttribute('dominant-baseline', 'alphabetic');
    element.setAttribute('alignment-baseline', 'alphabetic');
    element.style.fontSize = position.fontSize < size ? `${position.fontSize}px` : '';
    element.setAttribute('x', String(Number(position.x.toFixed(3))));
    element.setAttribute('y', String(Number(position.y.toFixed(3))));
  };
}
