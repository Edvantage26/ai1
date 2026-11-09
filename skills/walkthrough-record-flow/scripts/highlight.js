// Marks what the user clicks or looks at before a screenshot: a red frame with a step label around the
// element. For a browser tool's "evaluate on element" (Playwright MCP browser_evaluate with `ref`):
// pass this function with __LABEL__ replaced by the step label ("2 · Reservar"). Calling it again moves
// the frame; call it with a null element to remove the frame before a clean screenshot.
(element) => {
  document.getElementById('ai1-highlight')?.remove();
  if (!element) return 'removed';
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const elementBox = element.getBoundingClientRect();
  const highlightFrame = document.createElement('div');
  highlightFrame.id = 'ai1-highlight';
  Object.assign(highlightFrame.style, {
    position: 'fixed', left: `${elementBox.left - 6}px`, top: `${elementBox.top - 6}px`,
    width: `${elementBox.width + 12}px`, height: `${elementBox.height + 12}px`,
    border: '3px solid #d62d20', borderRadius: '6px', zIndex: 2147483647, pointerEvents: 'none', boxSizing: 'border-box',
  });
  const highlightLabel = document.createElement('span');
  highlightLabel.textContent = '__LABEL__';
  Object.assign(highlightLabel.style, {
    position: 'absolute', left: '-3px', top: elementBox.top > 40 ? '-30px' : 'calc(100% + 4px)',
    background: '#d62d20', color: '#fff', font: '600 13px/1 system-ui, sans-serif', padding: '6px 8px', borderRadius: '4px', whiteSpace: 'nowrap',
  });
  highlightFrame.appendChild(highlightLabel);
  document.body.appendChild(highlightFrame);
  return 'highlighted';
}
