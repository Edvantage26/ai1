// `ai1 storyboard build`: the storyboard as one self-contained `index.html` (images inlined, no
// network; slides with the arrow keys or a strip; before/after side by side; a print stylesheet with
// one step per page, which the PDF uses) and `SUMMARY.md` (steps as text with relative image links:
// the light input any publisher can take).

import { statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { readStoryboard, readImageBytes, stepChange, storyboardHasBefore, storyboardHasNotes, VIEWPORTS } from './storyboard-steps.mjs';

export const HTML_FILE_NAME = 'index.html';
export const SUMMARY_FILE_NAME = 'SUMMARY.md';
export const HEAVY_STORYBOARD_BYTES = 20 * 1024 * 1024;
const IMAGE_MIME_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const CHANGE_LABELS = { new: 'New step', removed: 'Removed step' };
export const SYNTHETIC_NOTES_LINE = 'Usability findings are synthetic: an agent playing the user, not a real person. Confirm P0 and P1 with someone of that profile.';

const escapeHtml = (rawText) => String(rawText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function findCapture(storyboardStep, variant, viewport) {
  return storyboardStep.captures.find((stepCapture) => stepCapture.variant === variant && stepCapture.viewport === viewport);
}

const MISSING_CAPTURE_TEXTS = { new: { before: 'not in the base version' }, removed: { after: 'no longer in the flow' } };

function renderCaptureCell(storyboardPath, stepCapture, cellLabel, missingText = 'not captured') {
  if (!stepCapture) return `<figure class="shot shot-missing"><figcaption>${escapeHtml(cellLabel)}</figcaption><div class="missing">${missingText}</div></figure>`;
  const imageData = readImageBytes(storyboardPath, stepCapture.image).toString('base64');
  const mimeType = IMAGE_MIME_TYPES[extname(stepCapture.image).toLowerCase()] ?? 'image/png';
  return `<figure class="shot shot-${stepCapture.viewport}"><figcaption>${escapeHtml(cellLabel)}</figcaption><img alt="${escapeHtml(cellLabel)}" src="data:${mimeType};base64,${imageData}"></figure>`;
}

// The base's own wording of the step, shown when it differs from the new one.
function beforeCaptionLine(storyboardStep) {
  const beforeCaption = storyboardStep.before_caption;
  return beforeCaption && beforeCaption !== storyboardStep.caption ? `<p class="before-caption">Before: ${escapeHtml(beforeCaption)}</p>` : '';
}

// One line per note: severity, profile, viewport, finding and the proposed fix.
function noteLabelParts(stepNote) {
  return [stepNote.profile, stepNote.viewport].filter(Boolean);
}

function renderStepNotes(storyboardStep) {
  if (!storyboardStep.notes?.length) return '';
  const noteItems = storyboardStep.notes.map((stepNote) => {
    const labelParts = noteLabelParts(stepNote);
    return `<li class="note note-${stepNote.severity.toLowerCase()}"><span class="severity">${escapeHtml(stepNote.severity)}</span>${labelParts.length ? `<span class="note-who">${escapeHtml(labelParts.join(' · '))}</span>` : ''}<span class="note-text">${escapeHtml(stepNote.text)}</span>${stepNote.fix ? `<span class="note-fix">Fix: ${escapeHtml(stepNote.fix)}</span>` : ''}</li>`;
  }).join('');
  return `<ul class="notes" aria-label="Usability findings">${noteItems}</ul>`;
}

function renderStep(storyboardPath, storyboardStep, stepNumber, stepCount, hasBefore) {
  const change = stepChange(storyboardStep, hasBefore);
  const shownVariants = hasBefore ? ['before', 'after'] : ['after'];
  const capturedViewports = VIEWPORTS.filter((viewport) => storyboardStep.captures.some((stepCapture) => stepCapture.viewport === viewport));
  const viewportRows = capturedViewports.map((viewport) => {
    const rowCells = shownVariants.map((variant) => renderCaptureCell(
      storyboardPath, findCapture(storyboardStep, variant, viewport), hasBefore ? `${variant} · ${viewport}` : viewport, MISSING_CAPTURE_TEXTS[change]?.[variant],
    ));
    return `<div class="row row-${viewport} cols-${shownVariants.length}">${rowCells.join('')}</div>`;
  }).join('');
  return `<section class="step${change ? ` step-${change}` : ''}" id="step-${stepNumber}">
<header class="step-head"><span class="step-number">${stepNumber}<small>/${stepCount}</small></span><div><h2>${escapeHtml(storyboardStep.caption)}</h2>${beforeCaptionLine(storyboardStep)}${storyboardStep.detail ? `<p>${escapeHtml(storyboardStep.detail)}</p>` : ''}</div>${change ? `<span class="badge badge-${change}">${CHANGE_LABELS[change]}</span>` : ''}</header>
${renderStepNotes(storyboardStep)}${viewportRows}
</section>`;
}

const STORYBOARD_STYLE = `
:root{--ink:#1d1f21;--muted:#62666d;--line:#d9dcdf;--paper:#f6f5f2;--card:#fff;--accent:#0b6e4f;--removed:#a33a2b}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--paper)}
.top{position:sticky;top:0;z-index:2;display:flex;gap:16px;align-items:center;padding:12px 24px;background:var(--ink);color:#fff}
.top h1{font-size:17px;margin:0;flex:1;font-weight:600}.top .meta{color:#c7cacd;font-size:13px}
.top button{font:inherit;font-size:13px;padding:6px 12px;border-radius:6px;border:1px solid #5a5e63;background:transparent;color:#fff;cursor:pointer}
.top button[aria-pressed=true]{background:#fff;color:var(--ink)}
main{max-width:1400px;margin:0 auto;padding:24px}
.step{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px;margin-bottom:24px}
.step-head{display:flex;gap:16px;align-items:flex-start;margin-bottom:16px}.step-head h2{font-size:20px;margin:0}.step-head p{margin:4px 0 0;color:var(--muted)}
.step-number{font-size:28px;font-weight:700;line-height:1;color:var(--accent);min-width:56px}.step-number small{font-size:13px;color:var(--muted);font-weight:400}
.badge{margin-left:auto;font-size:12px;font-weight:600;padding:3px 8px;border-radius:4px;white-space:nowrap}
.badge-new{background:#e3f1ea;color:var(--accent)}.badge-removed{background:#f6e4e1;color:var(--removed)}
.row{display:grid;gap:16px;margin-top:12px}.cols-2{grid-template-columns:1fr 1fr}.cols-1{grid-template-columns:1fr}
.row-mobile.cols-1{grid-template-columns:minmax(0,420px)}.row-mobile.cols-2{grid-template-columns:repeat(2,minmax(0,420px))}
.shot{margin:0}.shot figcaption{font-size:12px;text-transform:capitalize;color:var(--muted);margin-bottom:6px}
.shot img{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:6px;cursor:zoom-in}
.step-head .before-caption{color:var(--muted);font-style:italic}
.notes{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:6px}.note{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;padding:8px 10px;border-radius:6px;background:#f2f1ee;border-left:3px solid var(--line)}
.note-p0,.note-p1{background:#f6e4e1;border-left-color:var(--removed)}.severity{font-size:12px;font-weight:700}.note-p0 .severity,.note-p1 .severity{color:var(--removed)}
.note-who{font-size:12px;color:var(--muted)}.note-text{flex:1 1 60%}.note-fix{flex-basis:100%;font-size:13px;color:var(--muted)}
.synthetic{max-width:1400px;margin:16px auto 0;padding:0 24px;color:var(--muted);font-size:13px}
.zoom{position:fixed;inset:0;z-index:5;display:grid;place-items:center;background:rgba(20,22,24,.88);cursor:zoom-out;padding:24px}.zoom img{max-width:100%;max-height:100%;border-radius:6px}
.missing{display:grid;place-items:center;min-height:120px;border:1px dashed var(--line);border-radius:6px;color:var(--muted);font-size:13px}
body.slides .step{display:none;min-height:calc(100vh - 110px)}body.slides .step.current{display:block}
.pager{display:none;gap:8px;align-items:center}body.slides .pager{display:flex}
@page{size:A4 landscape;margin:10mm}
@media print{.zoom{display:none}.top{position:static;background:none;color:var(--ink);border-bottom:2px solid var(--ink)}.top button,.pager{display:none!important}
body{background:#fff}main{padding:0;max-width:none}body.slides .step,.step{display:block!important;min-height:0;border:0;padding:0;break-after:page;page-break-after:always}
.step:last-child{break-after:auto;page-break-after:auto}.step-head{margin-bottom:6px}.row{break-inside:avoid;margin-top:6px}
.shot img{max-height:34vh;width:auto;max-width:100%}.missing{min-height:60px}}
`;

const STORYBOARD_SCRIPT = `
(function(){var steps=[].slice.call(document.querySelectorAll('.step'));var index=0;var label=document.getElementById('pager-label');
function show(next){if(!steps.length)return;index=Math.max(0,Math.min(steps.length-1,next));steps.forEach(function(step,position){step.classList.toggle('current',position===index)});label.textContent=(index+1)+' / '+steps.length;}
function mode(slides){document.body.classList.toggle('slides',slides);document.getElementById('mode-slides').setAttribute('aria-pressed',slides);document.getElementById('mode-strip').setAttribute('aria-pressed',!slides);if(slides)show(index);}
document.getElementById('mode-slides').onclick=function(){mode(true)};document.getElementById('mode-strip').onclick=function(){mode(false)};
document.getElementById('prev').onclick=function(){show(index-1)};document.getElementById('next').onclick=function(){show(index+1)};
document.querySelectorAll('.shot img').forEach(function(image){image.onclick=function(){var zoom=document.createElement('div');zoom.className='zoom';zoom.innerHTML='<img alt="">';zoom.firstChild.src=image.src;zoom.onclick=function(){zoom.remove()};document.body.appendChild(zoom);};});
document.addEventListener('keydown',function(event){if(event.key==='Escape'){var openZoom=document.querySelector('.zoom');if(openZoom)openZoom.remove();}if(!document.body.classList.contains('slides'))return;if(event.key==='ArrowRight'||event.key===' ')show(index+1);if(event.key==='ArrowLeft')show(index-1);});
mode(true);})();
`;

export function renderStoryboardHtml(storyboardPath, storyboard) {
  const hasBefore = storyboardHasBefore(storyboard);
  const stepSections = storyboard.steps.map((storyboardStep, stepIndex) => renderStep(storyboardPath, storyboardStep, stepIndex + 1, storyboard.steps.length, hasBefore));
  const metaText = [`${storyboard.steps.length} steps`, hasBefore ? `before/after${storyboard.base ? ` vs ${storyboard.base}` : ''}` : null].filter(Boolean).join(' · ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(storyboard.title)} - storyboard</title><style>${STORYBOARD_STYLE}</style></head>
<body><div class="top"><h1>${escapeHtml(storyboard.title)}</h1><span class="meta">${escapeHtml(metaText)}</span>
<div class="pager"><button id="prev" aria-label="Previous step">&larr;</button><span id="pager-label" class="meta"></span><button id="next" aria-label="Next step">&rarr;</button></div>
<button id="mode-slides" aria-pressed="true">Slides</button><button id="mode-strip" aria-pressed="false">Strip</button></div>
${storyboardHasNotes(storyboard) ? `<p class="synthetic">${escapeHtml(SYNTHETIC_NOTES_LINE)}</p>` : ''}<main>${stepSections.join('\n')}</main><script>${STORYBOARD_SCRIPT}</script></body></html>
`;
}

export function renderStoryboardSummary(storyboard) {
  const hasBefore = storyboardHasBefore(storyboard);
  const summaryLines = [`# ${storyboard.title}`, ''];
  if (storyboardHasNotes(storyboard)) summaryLines.push(`> ${SYNTHETIC_NOTES_LINE}`, '');
  storyboard.steps.forEach((storyboardStep, stepIndex) => {
    const change = stepChange(storyboardStep, hasBefore);
    summaryLines.push(`## ${stepIndex + 1}. ${storyboardStep.caption}${change ? ` (${CHANGE_LABELS[change].toLowerCase()})` : ''}`, '');
    if (storyboardStep.before_caption && storyboardStep.before_caption !== storyboardStep.caption) summaryLines.push(`Before: ${storyboardStep.before_caption}`, '');
    if (storyboardStep.detail) summaryLines.push(storyboardStep.detail, '');
    if (storyboardStep.notes?.length) {
      summaryLines.push('Findings:', '');
      for (const stepNote of storyboardStep.notes) {
        const labelParts = noteLabelParts(stepNote);
        summaryLines.push(`- **${stepNote.severity}**${labelParts.length ? ` (${labelParts.join(', ')})` : ''}: ${stepNote.text}${stepNote.fix ? ` Fix: ${stepNote.fix}` : ''}`);
      }
      summaryLines.push('');
    }
    for (const stepCapture of storyboardStep.captures) summaryLines.push(`![${stepCapture.variant} ${stepCapture.viewport}](${stepCapture.image})`);
    summaryLines.push('');
  });
  return summaryLines.join('\n');
}

// Writes index.html and SUMMARY.md; returns their paths and a warning when the HTML is heavy.
export function buildStoryboard(storyboardPath) {
  const storyboard = readStoryboard(storyboardPath);
  if (!storyboard?.steps?.length) throw new Error(`no steps in ${storyboardPath}: add them first with \`ai1 storyboard add\``);
  const htmlPath = join(storyboardPath, HTML_FILE_NAME);
  const summaryPath = join(storyboardPath, SUMMARY_FILE_NAME);
  writeFileSync(htmlPath, renderStoryboardHtml(storyboardPath, storyboard));
  writeFileSync(summaryPath, renderStoryboardSummary(storyboard));
  const htmlBytes = statSync(htmlPath).size;
  return {
    htmlPath, summaryPath, htmlBytes, stepCount: storyboard.steps.length,
    warning: htmlBytes > HEAVY_STORYBOARD_BYTES ? `index.html weighs ${Math.round(htmlBytes / 1048576)} MB: use SUMMARY.md + images/ (or the PDF) to share it` : null,
  };
}
