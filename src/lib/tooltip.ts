let tip: HTMLElement | null = null;

function ensure(): HTMLElement {
  if (tip && document.body.contains(tip)) return tip;
  tip = document.createElement('div');
  tip.id = 'tooltip';
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  return tip;
}

export function showTip(html: string, x: number, y: number): void {
  const el = ensure();
  el.innerHTML = html;
  el.hidden = false;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = x + 14;
  if (left + w > vw - 8) left = x - w - 14;
  let top = y + 14;
  if (top + h > vh - 8) top = y - h - 14;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function hideTip(): void {
  if (tip) tip.hidden = true;
}