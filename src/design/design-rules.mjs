// Deterministic design checks for UI source files (feature `design`): the generic "AI look" and
// basic quality problems that can be seen in the source without rendering the page. Plain regex
// and arithmetic, no LLM, no dependencies.
//
// Rule ids and the problems they name follow the anti-pattern catalogue of Impeccable
// (https://github.com/pbakaus/impeccable, Apache 2.0, by Paul Bakaus). The checks are written from
// scratch for source text; no code was taken from it. Problems that need the rendered page (real
// contrast over images, overflow, line length) are left to Impeccable's own detector.
//
// A rule: { id, category: 'slop' | 'quality', isHint?, fileKinds, summary, findLines(uiFile) -> [line] }
// `uiFile` is { kind: 'style' | 'markup', text, lines }; line numbers are 1-based.

import { extname } from 'node:path';

const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less', '.pcss']);
const MARKUP_EXTENSIONS = new Set(['.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte', '.astro']);

export function classifyUiFile(filePath) {
  // Minified bundles are build output, not something to review line by line.
  if (/\.min\.[a-z]+$/i.test(String(filePath || ''))) return null;
  const fileExtension = extname(String(filePath || '')).toLowerCase();
  if (STYLE_EXTENSIONS.has(fileExtension)) return 'style';
  if (MARKUP_EXTENSIONS.has(fileExtension)) return 'markup';
  return null;
}

// --- colour arithmetic --------------------------------------------------------------------------

export function parseCssColor(colorText) {
  const colorValue = String(colorText || '').trim().toLowerCase();
  const hexMatch = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(colorValue);
  if (hexMatch) {
    const hexDigits = hexMatch[1].length <= 4 ? [...hexMatch[1]].map((hexDigit) => hexDigit + hexDigit).join('') : hexMatch[1];
    return {
      red: parseInt(hexDigits.slice(0, 2), 16),
      green: parseInt(hexDigits.slice(2, 4), 16),
      blue: parseInt(hexDigits.slice(4, 6), 16),
      alpha: hexDigits.length === 8 ? parseInt(hexDigits.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgbMatch = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(colorValue);
  if (rgbMatch) {
    const alphaText = rgbMatch[4];
    const alpha = alphaText === undefined ? 1 : alphaText.endsWith('%') ? parseFloat(alphaText) / 100 : parseFloat(alphaText);
    return { red: Number(rgbMatch[1]), green: Number(rgbMatch[2]), blue: Number(rgbMatch[3]), alpha };
  }
  return null;
}

export function hslFromColor({ red, green, blue }) {
  const [redRatio, greenRatio, blueRatio] = [red / 255, green / 255, blue / 255];
  const maximum = Math.max(redRatio, greenRatio, blueRatio);
  const minimum = Math.min(redRatio, greenRatio, blueRatio);
  const lightness = (maximum + minimum) / 2;
  const chroma = maximum - minimum;
  if (chroma === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  let hueSector;
  if (maximum === redRatio) hueSector = ((greenRatio - blueRatio) / chroma) % 6;
  else if (maximum === greenRatio) hueSector = (blueRatio - redRatio) / chroma + 2;
  else hueSector = (redRatio - greenRatio) / chroma + 4;
  return { hue: (hueSector * 60 + 360) % 360, saturation, lightness };
}

function relativeLuminance({ red, green, blue }) {
  const linearChannel = (channelValue) => {
    const channelRatio = channelValue / 255;
    return channelRatio <= 0.03928 ? channelRatio / 12.92 : ((channelRatio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

export function contrastRatio(foregroundColor, backgroundColor) {
  const [lighterLuminance, darkerLuminance] = [relativeLuminance(foregroundColor), relativeLuminance(backgroundColor)].sort((first, second) => second - first);
  return (lighterLuminance + 0.05) / (darkerLuminance + 0.05);
}

const isPurpleColor = (parsedColor) => {
  const { hue, saturation, lightness } = hslFromColor(parsedColor);
  return hue >= 255 && hue <= 300 && saturation >= 0.4 && lightness > 0.2 && lightness < 0.85;
};
const isSaturatedColor = (parsedColor) => {
  const { saturation, lightness } = hslFromColor(parsedColor);
  return saturation >= 0.4 && lightness > 0.15 && lightness < 0.9;
};
const isCreamColor = (parsedColor) => {
  const { hue, saturation, lightness } = hslFromColor(parsedColor);
  return hue >= 25 && hue <= 60 && saturation >= 0.2 && lightness >= 0.88 && lightness < 0.98;
};

const COLOR_PATTERN = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
const listColorsIn = (text) => (String(text).match(COLOR_PATTERN) || []).map(parseCssColor).filter(Boolean);

// --- helpers to locate matches --------------------------------------------------------------------

const lineNumberAt = (text, characterIndex) => text.slice(0, characterIndex).split('\n').length;

function linesMatching(uiFile, lineTest) {
  const matchingLines = [];
  uiFile.lines.forEach((lineText, lineIndex) => {
    if (lineTest(lineText, lineIndex)) matchingLines.push(lineIndex + 1);
  });
  return matchingLines;
}

// Visible text of markup: what sits between tags, one entry per line.
function listTextSegments(uiFile) {
  const textSegments = [];
  uiFile.lines.forEach((lineText, lineIndex) => {
    for (const segmentMatch of lineText.matchAll(/>([^<>{}]+)</g)) {
      if (segmentMatch[1].trim()) textSegments.push({ line: lineIndex + 1, text: segmentMatch[1] });
    }
  });
  return textSegments;
}

// CSS rule blocks (`selector { declarations }`) in a stylesheet or a <style> element.
function listCssBlocks(uiFile) {
  const cssBlocks = [];
  for (const blockMatch of uiFile.text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    cssBlocks.push({ selector: blockMatch[1].trim(), declarations: blockMatch[2], startIndex: blockMatch.index + blockMatch[1].length });
  }
  return cssBlocks;
}

function readDeclaration(declarationsText, propertyPattern) {
  const declarationMatch = new RegExp(`(?:^|[;\\s{])(?:${propertyPattern})\\s*:\\s*([^;]+)`, 'i').exec(declarationsText);
  return declarationMatch ? { value: declarationMatch[1].trim(), offset: declarationMatch.index } : null;
}

const SMALL_SIZE_CLASS = /\b(?:w|h|size)-(?:1|1\.5|2|2\.5|3)\b/;
const OVERUSED_FONT_NAMES = ['Inter', 'Roboto', 'Fraunces', 'Geist', 'Plus Jakarta Sans', 'Space Grotesk'];
const OVERUSED_FONT_ALTERNATION = OVERUSED_FONT_NAMES.map((fontName) => fontName.replace(/ /g, '[ _+-]')).join('|');
const BUZZWORDS = ['streamline', 'empower', 'supercharge', 'world-class', 'enterprise-grade', 'next-generation', 'next-gen',
  'cutting-edge', 'best-in-class', 'game-changing', 'game-changer', 'revolutionize', 'unleash', 'seamless', 'seamlessly'];
const CHROMATIC_TAILWIND_COLORS = 'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

// --- the rules ------------------------------------------------------------------------------------

export const DESIGN_RULES = [
  {
    id: 'overused-font',
    category: 'slop',
    fileKinds: ['style', 'markup'],
    summary: 'Inter, Roboto, Geist, Fraunces, Plus Jakarta Sans or Space Grotesk as the main font: the default of every generated UI. Pick a typeface that comes from the product.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) =>
      new RegExp(`font-family\\s*:\\s*['"]?(?:${OVERUSED_FONT_ALTERNATION})\\b`, 'i').test(lineText)
      || new RegExp(`fontFamily\\s*:\\s*[\`'"]\\s*['"]?(?:${OVERUSED_FONT_ALTERNATION})\\b`, 'i').test(lineText)
      || new RegExp(`\\b(?:${OVERUSED_FONT_ALTERNATION})\\b[^;]*from\\s+['"](?:next/font/google|geist/font)`).test(lineText)
      || new RegExp(`@fontsource(?:-variable)?/(?:${OVERUSED_FONT_ALTERNATION})\\b`, 'i').test(lineText)
      || new RegExp(`fonts\\.googleapis\\.com/css2?\\?family=(?:${OVERUSED_FONT_ALTERNATION})\\b`, 'i').test(lineText)
      || new RegExp(`\\bfont-\\[['"]?(?:${OVERUSED_FONT_ALTERNATION})\\b`, 'i').test(lineText)),
  },
  {
    id: 'gradient-text',
    category: 'slop',
    fileKinds: ['style', 'markup'],
    summary: 'Gradient-filled text is decoration, not meaning, and a common AI tell on headings and metrics. Use a solid colour.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) =>
      /background-clip\s*:\s*text|backgroundClip\s*:\s*['"]text|\bbg-clip-text\b/.test(lineText)),
  },
  {
    id: 'ai-color-palette',
    category: 'slop',
    fileKinds: ['style', 'markup'],
    summary: 'Purple / violet gradient: the most recognisable colour of generated UIs. Take the palette from the brand or the product.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) =>
      /\b(?:from|via|to)-(?:purple|violet|fuchsia|indigo)-[3-9]00\b/.test(lineText)
      || (/gradient\(/i.test(lineText) && listColorsIn(lineText).some(isPurpleColor))),
  },
  {
    id: 'side-tab',
    category: 'slop',
    fileKinds: ['style', 'markup'],
    summary: 'Thick coloured border on one side of a card: a signature of generated UIs. Use a subtler accent or none.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) =>
      /\bborder-[lrse]-(?:4|8|\[(?:[3-9]|\d{2,})px\])(?=[\s"'`]|$)/.test(lineText)
      || /border-(?:left|right|inline-start|inline-end)\s*:\s*(?:[3-9]|\d{2,})px\s+solid/i.test(lineText)
      || /border(?:Left|Right|InlineStart|InlineEnd)\s*:\s*['"`](?:[3-9]|\d{2,})px\s+solid/.test(lineText)),
  },
  {
    id: 'dark-glow',
    category: 'slop',
    fileKinds: ['style', 'markup'],
    summary: 'Coloured glow (a zero-offset chromatic shadow): the default "cool" effect of generated UIs. Use a neutral shadow, or none.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) => {
      const glowMatch = /(?:box|text)-shadow\s*:\s*0(?:px)?\s+0(?:px)?\s+\d+px(?:\s+\d+px)?\s+(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/i.exec(lineText);
      if (glowMatch && parseCssColor(glowMatch[1]) && isSaturatedColor(parseCssColor(glowMatch[1]))) return true;
      return new RegExp(`\\bshadow-(?:${CHROMATIC_TAILWIND_COLORS})-\\d{2,3}(?:/\\d+)?\\b`).test(lineText)
        || /\bshadow-\[0_0_\d+px[^\]]*(?:#|rgba?\()/.test(lineText);
    }),
  },
  {
    id: 'bounce-easing',
    category: 'slop',
    isHint: true,
    fileKinds: ['style', 'markup'],
    summary: 'Bounce or elastic easing feels dated. Real objects decelerate smoothly: use an exponential ease-out.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) => {
      if (/\banimate-bounce\b|\b(?:easeOutBack|easeInOutBack|easeOutElastic|easeInOutElastic|easeOutBounce)\b|\b(?:back|elastic|bounce)\.(?:out|inOut)\b/.test(lineText)) return true;
      return [...lineText.matchAll(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g)]
        .some((bezierMatch) => [bezierMatch[2], bezierMatch[4]].map(Number).some((controlPoint) => controlPoint < 0 || controlPoint > 1));
    }),
  },
  {
    id: 'pulsing-dot',
    category: 'slop',
    fileKinds: ['markup'],
    summary: 'Small pulsing dot that fakes liveness. Animate only indicators tied to data that really changes; a static dot with a label reads better.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) =>
      /\banimate-(?:ping|pulse)\b/.test(lineText) && /\brounded-full\b/.test(lineText) && SMALL_SIZE_CLASS.test(lineText)),
  },
  {
    id: 'marquee',
    category: 'slop',
    fileKinds: ['style', 'markup'],
    summary: 'Endlessly scrolling content (marquee / logo ticker) asks for attention it has not earned and hides half of itself. Let people read at their pace.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) =>
      /<marquee\b|\banimate-(?:marquee|scroll-x|ticker)\b|@keyframes\s+(?:marquee|ticker|scroll-x)\b|animation(?:-name)?\s*:\s*[^;]*\b(?:marquee|ticker)\b/i.test(lineText)),
  },
  {
    id: 'kicker-above-heading',
    category: 'slop',
    fileKinds: ['markup'],
    summary: 'Tiny uppercase, letter-spaced label (or pill chip) right above a heading: the default generated hero and section. Let the heading stand alone.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText, lineIndex) =>
      /\buppercase\b/.test(lineText) && /\btracking-(?:wide|wider|widest|\[0?\.\d+em\])\b/.test(lineText)
      && /\btext-(?:xs|sm|\[1[0-3]px\])\b/.test(lineText) && !/<h[1-6]\b/.test(lineText)
      && uiFile.lines.slice(lineIndex + 1, lineIndex + 4).some((followingLine) => /<(?:h[1-6]|Heading)\b/.test(followingLine))),
  },
  {
    id: 'icon-tile-stack',
    category: 'slop',
    fileKinds: ['markup'],
    summary: 'Rounded-square icon tile stacked above a heading: the universal generated feature card. Try the icon beside the heading, or no icon.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText, lineIndex) =>
      /\brounded-(?:md|lg|xl|2xl)\b/.test(lineText) && /\b(?:size|w|h)-(?:8|9|10|11|12|14)\b/.test(lineText)
      && /\bitems-center\b/.test(lineText) && /\bjustify-center\b/.test(lineText) && /\bbg-/.test(lineText)
      && uiFile.lines.slice(lineIndex + 1, lineIndex + 5).some((followingLine) => /<h[2-4]\b/.test(followingLine))),
  },
  {
    id: 'italic-serif-display',
    category: 'slop',
    fileKinds: ['markup'],
    summary: 'Oversized italic serif as the hero headline: the new default of AI startup pages. Choose the display face for this product.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) =>
      /<h1\b/.test(lineText) && /\bitalic\b/.test(lineText) && /\bfont-serif\b|Fraunces|Playfair|Recoleta|Newsreader/.test(lineText)),
  },
  {
    id: 'cream-palette',
    category: 'slop',
    fileKinds: ['style', 'markup'],
    summary: 'Warm cream / beige page background: the reflex "tasteful" surface of generated UIs. Take the background from a deliberate palette.',
    findLines: (uiFile) => {
      const creamLines = [];
      for (const cssBlock of listCssBlocks(uiFile)) {
        if (!/(?:^|[\s,])(?:html|body|:root)\b/.test(cssBlock.selector)) continue;
        const backgroundDeclaration = readDeclaration(cssBlock.declarations, 'background-color|background');
        const backgroundColor = backgroundDeclaration && listColorsIn(backgroundDeclaration.value)[0];
        if (backgroundColor && isCreamColor(backgroundColor)) {
          creamLines.push(lineNumberAt(uiFile.text, cssBlock.startIndex + backgroundDeclaration.offset + 1));
        }
      }
      return creamLines.concat(linesMatching(uiFile, (lineText) =>
        /<(?:html|body|main)\b[^>]*\bbg-(?:amber|orange|stone|yellow)-(?:50|100)\b/.test(lineText)));
    },
  },
  {
    id: 'marketing-buzzword',
    category: 'slop',
    fileKinds: ['markup'],
    summary: 'Generic SaaS wording (streamline, empower, seamless, cutting-edge...): an instant AI tell. Say the specific thing the product does.',
    findLines: (uiFile) => listTextSegments(uiFile)
      .filter((textSegment) => new RegExp(`\\b(?:${BUZZWORDS.join('|')})\\b`, 'i').test(textSegment.text))
      .map((textSegment) => textSegment.line),
  },
  {
    id: 'em-dash-overuse',
    category: 'slop',
    isHint: true,
    fileKinds: ['markup'],
    summary: 'Em dashes all over the copy (8 or more in the file): an AI cadence. Use commas, colons or full stops.',
    findLines: (uiFile) => {
      const dashSegments = listTextSegments(uiFile).filter((textSegment) => /—|\s--\s/.test(textSegment.text));
      const dashCount = dashSegments.reduce((runningCount, textSegment) => runningCount + (textSegment.text.match(/—|\s--\s/g) || []).length, 0);
      return dashCount >= 8 ? dashSegments.map((textSegment) => textSegment.line) : [];
    },
  },
  {
    id: 'theater-slop-phrase',
    category: 'slop',
    isHint: true,
    fileKinds: ['markup'],
    summary: 'Calling something "theater" is a generated-copy tic. Say plainly what it does or does not do.',
    findLines: (uiFile) => listTextSegments(uiFile).filter((textSegment) => /\btheat(?:er|re)\b/i.test(textSegment.text)).map((textSegment) => textSegment.line),
  },
  {
    id: 'repeating-stripes-gradient',
    category: 'slop',
    isHint: true,
    fileKinds: ['style', 'markup'],
    summary: 'Repeating-gradient stripes as surface decoration: a generated-UI signature. Use a deliberate texture or a plain surface.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) => /repeating-(?:linear|radial)-gradient\(/i.test(lineText)),
  },
  {
    id: 'codex-grid-background',
    category: 'slop',
    isHint: true,
    fileKinds: ['style', 'markup'],
    summary: 'Decorative hairline grid background: a generated-UI signature. Keep grids for content that is a grid.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) => /linear-gradient\([^)]*\b1px\s*,\s*transparent\s+1px/i.test(lineText)),
  },
  {
    id: 'hard-offset-shadow',
    category: 'quality',
    isHint: true,
    fileKinds: ['style', 'markup'],
    summary: 'Unblurred shadow offset by 4px or more: fine in a deliberate neo-brutalist style, odd anywhere else. Check that it fits the design.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) => {
      const offsetMatch = /box-shadow\s*:\s*(-?\d+)px\s+(-?\d+)px\s+0(?:px)?\b/i.exec(lineText) || /\bshadow-\[(-?\d+)px_(-?\d+)px_0(?:px)?_/.exec(lineText);
      return Boolean(offsetMatch) && Math.max(Math.abs(Number(offsetMatch[1])), Math.abs(Number(offsetMatch[2]))) >= 4;
    }),
  },
  {
    id: 'organic-clip-path',
    category: 'quality',
    fileKinds: ['style', 'markup'],
    summary: 'clip-path drawing a blob or torn edge with a curved path or a many-point polygon: the cheap version of an illustration. Use a real asset or a simple shape.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) => {
      if (/clip-?path\s*:\s*['"]?path\(/i.test(lineText)) return true;
      const polygonMatch = /clip-?path\s*:\s*['"]?polygon\(([^)]*)\)/i.exec(lineText);
      return Boolean(polygonMatch) && polygonMatch[1].split(',').length >= 8;
    }),
  },
  {
    id: 'extreme-negative-tracking',
    category: 'slop',
    fileKinds: ['style', 'markup'],
    summary: 'Letter-spacing tighter than -0.05em makes letters collide. Tighten display type optically, not destructively.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) =>
      [...lineText.matchAll(/(?:letter-spacing\s*:\s*|letterSpacing\s*:\s*['"`]|tracking-\[)(-\d*\.?\d+)em/gi)]
        .some((trackingMatch) => Number(trackingMatch[1]) < -0.05)),
  },
  {
    id: 'broken-image',
    category: 'quality',
    fileKinds: ['markup'],
    summary: 'Image with no src, an empty one, or a placeholder service: it ships as a broken box. Use a real asset or remove the tag.',
    // `<Image>` counts only with an alt: icon libraries also export an `Image` component.
    findLines: (uiFile) => [...uiFile.text.matchAll(/<(?:img|Image)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g)]
      .filter((imageTag) => imageTag[0].startsWith('<img') || /\balt\s*=/.test(imageTag[0]))
      .filter((imageTag) => !/\bsrc\s*=/.test(imageTag[0]) || /\bsrc\s*=\s*(?:""|''|"#"|\{\s*["']{2}\s*\})/.test(imageTag[0])
        || /placehold\.co|placehold\.it|via\.placeholder\.com|placekitten|dummyimage\.com|picsum\.photos/.test(imageTag[0]))
      .map((imageTag) => lineNumberAt(uiFile.text, imageTag.index)),
  },
  {
    id: 'skipped-heading',
    category: 'quality',
    fileKinds: ['markup'],
    summary: 'Heading level skipped (e.g. h1 then h3): screen readers navigate by that outline. Use the next level and style it as needed.',
    findLines: (uiFile) => {
      const skippedLines = [];
      let previousLevel = null;
      for (const headingMatch of uiFile.text.matchAll(/<h([1-6])\b/g)) {
        const headingLevel = Number(headingMatch[1]);
        if (previousLevel !== null && headingLevel > previousLevel + 1) skippedLines.push(lineNumberAt(uiFile.text, headingMatch.index));
        previousLevel = headingLevel;
      }
      return skippedLines;
    },
  },
  {
    id: 'gray-on-color',
    category: 'quality',
    fileKinds: ['markup'],
    summary: 'Gray text on a coloured background looks washed out. Use a dark shade of the background hue, or white.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) =>
      new RegExp(`\\bbg-(?:${CHROMATIC_TAILWIND_COLORS})-[4-9]00\\b`).test(lineText) && /\btext-(?:gray|slate|zinc|neutral|stone)-[3-6]00\b/.test(lineText)),
  },
  {
    id: 'low-contrast',
    category: 'quality',
    fileKinds: ['style', 'markup'],
    summary: 'Text colour against its background is below WCAG AA (4.5:1). Raise the contrast.',
    findLines: (uiFile) => {
      const lowContrastLines = [];
      for (const cssBlock of listCssBlocks(uiFile)) {
        const colorDeclaration = readDeclaration(cssBlock.declarations, 'color');
        const backgroundDeclaration = readDeclaration(cssBlock.declarations, 'background-color|background');
        if (!colorDeclaration || !backgroundDeclaration || /gradient|url\(/i.test(backgroundDeclaration.value)) continue;
        const textColor = parseCssColor(colorDeclaration.value.split(/\s/)[0]);
        const surfaceColor = parseCssColor(backgroundDeclaration.value.split(/\s/)[0]);
        if (!textColor || !surfaceColor || textColor.alpha < 1 || surfaceColor.alpha < 1) continue;
        if (contrastRatio(textColor, surfaceColor) < 4.5) lowContrastLines.push(lineNumberAt(uiFile.text, cssBlock.startIndex + colorDeclaration.offset + 1));
      }
      return lowContrastLines;
    },
  },
  {
    id: 'tiny-text',
    category: 'quality',
    fileKinds: ['style', 'markup'],
    summary: 'Text below 11px is a legibility failure, not a style. Use 14-16px for body text and at least 12px for labels.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) =>
      [...lineText.matchAll(/font-size\s*:\s*(\d*\.?\d+)(px|rem)\b/gi)].some((sizeMatch) => Number(sizeMatch[1]) * (sizeMatch[2].toLowerCase() === 'rem' ? 16 : 1) < 11)
      || [...lineText.matchAll(/\btext-\[(\d*\.?\d+)(px|rem)\]/g)].some((sizeMatch) => Number(sizeMatch[1]) * (sizeMatch[2] === 'rem' ? 16 : 1) < 11)
      || [...lineText.matchAll(/fontSize\s*:\s*['"`]?(\d*\.?\d+)(?:px)?['"`]?\s*[,}]/g)].some((sizeMatch) => Number(sizeMatch[1]) < 11)),
  },
  {
    id: 'justified-text',
    category: 'quality',
    isHint: true,
    fileKinds: ['style', 'markup'],
    summary: 'Justified text without hyphenation opens rivers of white in narrow columns. Prefer left-aligned text.',
    findLines: (uiFile) => linesMatching(uiFile, (lineText) => /text-align\s*:\s*justify|textAlign\s*:\s*['"]justify|\btext-justify\b/.test(lineText)),
  },
];

export const DESIGN_RULE_IDS = DESIGN_RULES.map((designRule) => designRule.id);

// Runs every rule that applies to the file kind. Returns [{ ruleId, line }], sorted by line.
export function scanUiFile(filePath, fileText, ignoredRuleIds = []) {
  const fileKind = classifyUiFile(filePath);
  if (!fileKind) return [];
  const uiFile = { kind: fileKind, text: fileText, lines: fileText.split('\n') };
  const designFindings = [];
  for (const designRule of DESIGN_RULES) {
    if (ignoredRuleIds.includes(designRule.id) || !designRule.fileKinds.includes(fileKind)) continue;
    for (const findingLine of new Set(designRule.findLines(uiFile))) designFindings.push({ ruleId: designRule.id, line: findingLine });
  }
  return designFindings.sort((firstFinding, secondFinding) => firstFinding.line - secondFinding.line);
}
