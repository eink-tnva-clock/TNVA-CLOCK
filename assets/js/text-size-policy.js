/*
 * TNVA 2.13" resident-font policy.
 *
 * The DA14585 contains two useful native text rasters:
 *   - the 5x7 ASCII table (font id 0), and
 *   - the full Vietnamese sfont table at 14px (font id 1).
 *
 * Scaling the 14px table down to 7..13px destroys one-pixel stems and
 * Vietnamese marks.  Keep those two native rasters intact instead.  This
 * module is deliberately web-only: it changes the TNF1 descriptor emitted by
 * the editor and makes the preview use the same choice; no firmware source is
 * involved.  The 4.2" tricolour designer is explicitly excluded.
 */

export const EINK213_TINY_TEXT_PX = 7;
export const EINK213_VIETNAMESE_TEXT_PX = 14;

const TEXTUAL_DYNAMIC_TYPES = new Set([
  'time', 'date', 'weekday', 'lunar', 'canchi', 'holiday',
  'temperature', 'voltage', 'batteryPercent',
  'dayOnly', 'monthOnly', 'yearOnly'
]);

/* These values are generated entirely from ASCII characters on the clock, so
 * at a requested size of 7..10px they can use the native 5x7 raster without
 * losing a Vietnamese glyph.  Text-bearing fields stay on native 14px. */
const ASCII_ONLY_DYNAMIC_TYPES = new Set([
  'time', 'date', 'temperature', 'voltage', 'batteryPercent',
  'dayOnly', 'monthOnly', 'yearOnly'
]);

function requestedPx(element) {
  const value = Number(element?.fontSize ?? 12);
  return Math.max(5, Math.round(Number.isFinite(value) ? value : 12));
}

export function isEink213Project(project) {
  if (Number(project?.planes || 1) === 2) return false;
  return !project?.deviceClass || project.deviceClass === 'eink213';
}

function isAscii(value) {
  return /^[\x20-\x7e\n]*$/.test(String(value ?? ''));
}

/*
 * Returns null when normal rendering is safe.  Otherwise the caller must use
 * BOTH renderPx and fontId for its preview/descriptor.  That shared contract
 * is what keeps the web preview and the physical display pixel-identical.
 */
export function crisp213TextPlan(project, element, renderedText = '') {
  if (!isEink213Project(project) || !element) return null;
  const requested = requestedPx(element);
  if (requested >= EINK213_VIETNAMESE_TEXT_PX) return null;

  if (element.type === 'text') {
    /* canchiSans is the static counterpart of the resident Vietnamese
     * bitmap.  Other static web fonts are baked directly into the bitplane
     * and therefore do not pass through the DA14585 scaler at all. */
    if (element.font !== 'canchiSans') return null;
    if (requested <= 10 && isAscii(renderedText)) {
      return { requestedPx: requested, renderPx: EINK213_TINY_TEXT_PX, fontId: 0, mode: 'tiny' };
    }
    return { requestedPx: requested, renderPx: EINK213_VIETNAMESE_TEXT_PX, fontId: 1, mode: 'native-vietnamese' };
  }

  if (!TEXTUAL_DYNAMIC_TYPES.has(element.type)) return null;
  /* Outline/solid/segment styles are geometric strokes, not the resident
   * sfont bitmap, so they already stay sharp and must keep their own path. */
  if ([1, 2, 3].includes(Number(element.templateStyle || 0))) return null;
  /* Time has its own >=12px clock-font branch in the existing DA14585.
   * Keeping every sub-14px time on native 5x7 avoids crossing that branch
   * and guarantees the preview and device take the very same renderer. */
  if (element.type === 'time' || (requested <= 10 && ASCII_ONLY_DYNAMIC_TYPES.has(element.type))) {
    return { requestedPx: requested, renderPx: EINK213_TINY_TEXT_PX, fontId: 0, mode: 'tiny' };
  }

  /* Weekday, lunar text, Can Chi and holidays may contain Vietnamese at any
   * moment.  They therefore always use the complete native 14px glyphs.
   * Requested 11..13px ASCII fields use the same tier rather than a blurry
   * fractional scale. */
  return { requestedPx: requested, renderPx: EINK213_VIETNAMESE_TEXT_PX, fontId: 1, mode: 'native-vietnamese' };
}

export const CRISP213_TEXTUAL_DYNAMIC_TYPES = Object.freeze([...TEXTUAL_DYNAMIC_TYPES]);
export const CRISP213_ASCII_DYNAMIC_TYPES = Object.freeze([...ASCII_ONLY_DYNAMIC_TYPES]);

function crc32Bytes(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function packageDescriptorPlan(type, requested, style, templateText) {
  if (requested >= EINK213_VIETNAMESE_TEXT_PX) return null;
  if ([1, 2, 3].includes(style)) return null;

  if (type === 1) return { fontId: 0, renderPx: 7 }; /* time */
  if (type === 3 || type === 4) return { fontId: 1, renderPx: 14 }; /* weekday/lunar */
  if (type === 2 || type === 5) { /* date/voltage */
    return requested <= 10 ? { fontId: 0, renderPx: 7 } : { fontId: 1, renderPx: 14 };
  }
  if (type === 6) { /* legacy battery text; style 6 is the battery icon */
    if (style === 6) return null;
    return requested <= 10 ? { fontId: 0, renderPx: 7 } : { fontId: 1, renderPx: 14 };
  }
  if (type !== 8) return null; /* template */
  if (typeof templateText !== 'string') return null;

  /* @W, @K and @H can expand to Vietnamese at run time even when the stored
   * template itself is ASCII.  Literal non-ASCII text needs the same table. */
  const canProduceVietnamese = /@(W|K|H)/.test(templateText) || !isAscii(templateText);
  if (!canProduceVietnamese && requested <= 10) return { fontId: 0, renderPx: 7 };
  return { fontId: 1, renderPx: 14 };
}

/*
 * Repairs already-built TNF1 packages (warehouse/community/downloads) on the
 * web side before transfer.  Packages generated by FaceEditor.compile() are
 * already correct; this idempotent pass covers older assets that bypass the
 * editor.  Header/payload length never changes, only descriptor font/size and
 * the payload CRC are updated.
 */
export function normalizeCrisp213Package(input) {
  if (!(input instanceof Uint8Array) || input.byteLength < 20) return input;
  const sourceView = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (sourceView.getUint32(0, true) !== 0x31464e54) return input;
  const version = input[4];
  if ((version !== 1 && version !== 2) || input[5] !== 212 || input[6] !== 104 || input[7] !== 27) return input;

  const headerSize = version === 2 ? 24 : 20;
  const bitplaneLength = sourceView.getUint16(8, true);
  const descriptorCount = input[10];
  const descriptorSize = version === 2 ? input[11] : 12;
  const stringLength = version === 2 ? sourceView.getUint16(12, true) : 0;
  const totalSize = sourceView.getUint16(version === 2 ? 14 : 12, true);
  if (headerSize + bitplaneLength + descriptorCount * descriptorSize + stringLength !== input.byteLength ||
      totalSize !== input.byteLength || descriptorCount > 24 ||
      descriptorSize !== (version === 2 ? 16 : 12)) return input;

  const output = new Uint8Array(input);
  const outputView = new DataView(output.buffer);
  const descriptorBase = headerSize + bitplaneLength;
  const stringBase = descriptorBase + descriptorCount * descriptorSize;
  let changed = false;

  for (let index = 0; index < descriptorCount; index++) {
    const offset = descriptorBase + index * descriptorSize;
    const type = output[offset];
    const requested = output[offset + 8];
    const style = version === 2 ? output[offset + 13] : 0;
    let templateText = type === 8 ? null : '';
    if (version === 2 && type === 8) {
      const stringOffset = output[offset + 10] | (output[offset + 11] << 8);
      const length = output[offset + 12];
      if (stringOffset + length <= stringLength) {
        templateText = new TextDecoder().decode(output.subarray(stringBase + stringOffset, stringBase + stringOffset + length));
      }
    }
    const plan = packageDescriptorPlan(type, requested, style, templateText);
    if (!plan) continue;
    if (output[offset + 1] !== plan.fontId || output[offset + 8] !== plan.renderPx) {
      output[offset + 1] = plan.fontId;
      output[offset + 8] = plan.renderPx;
      changed = true;
    }
  }

  if (!changed) return input;
  const crcOffset = version === 2 ? 20 : 16;
  outputView.setUint32(crcOffset, crc32Bytes(output.subarray(headerSize)), true);
  return output;
}
