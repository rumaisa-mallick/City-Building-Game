/**
 * Direction cursor: the system arrow is suppressed (cursor: none on #app) and
 * a pixel arrowhead stands in for it — it faces wherever the mouse last
 * travelled and holds that heading when the mouse stops, so the direction you
 * moved is the side the arrow keeps pointing at. Interactive controls declare
 * their own native cursor in CSS and hide this one, so buttons and sliders
 * keep their familiar pointer. Inline SVG, zero assets.
 */
export function attachDirectionCursor(): void {
  const el = document.createElement('div');
  el.className = 'dir-cursor';
  el.setAttribute('aria-hidden', 'true');
  // Pixel triangle pointing east with a short tail; the tip sits at (20, 10),
  // which is also the rotation origin so the point stays glued to the mouse.
  el.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 20 20" shape-rendering="crispEdges">' +
    '<g fill="#f2f7f4">' +
    '<rect x="0" y="8" width="6" height="4"/>' +
    '<rect x="6" y="2" width="4" height="16"/>' +
    '<rect x="10" y="4" width="4" height="12"/>' +
    '<rect x="14" y="6" width="4" height="8"/>' +
    '<rect x="18" y="8" width="2" height="4"/>' +
    '</g></svg>';
  document.body.appendChild(el);

  const TIP_X = 20;
  const TIP_Y = 10;
  let x = 0;
  let y = 0;
  let px = -1;
  let py = -1;
  let heading = 0; // radians, 0 = east
  let target = 0;
  let shown = false;
  let raf = 0;

  const draw = (): void => {
    const deg = ((heading * 180) / Math.PI).toFixed(1);
    el.style.transform =
      `translate(${(x - TIP_X).toFixed(1)}px, ${(y - TIP_Y).toFixed(1)}px) rotate(${deg}deg)`;
  };

  const tick = (): void => {
    raf = 0;
    // shortest way around the circle, eased so turns read as a swing
    const d = (((target - heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    heading += d * 0.3;
    draw();
    if (Math.abs(d) > 0.005) raf = requestAnimationFrame(tick);
  };

  const hide = (): void => {
    if (!shown) return;
    shown = false;
    el.classList.remove('on');
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const overCtl =
      e.target instanceof Element &&
      e.target.closest('button, input, select, textarea, label, a[href]');
    // sell-mode draws its own crosshair; controls draw their own pointer
    if (overCtl || document.body.classList.contains('sell-mode')) {
      hide();
      return;
    }
    const dx = e.clientX - px;
    const dy = e.clientY - py;
    px = e.clientX;
    py = e.clientY;
    x = e.clientX;
    y = e.clientY;
    if (dx !== 0 || dy !== 0) target = Math.atan2(dy, dx);
    if (!shown) {
      shown = true;
      heading = target; // arrive already facing the first move — no spin-in
      el.classList.add('on');
      draw();
      return;
    }
    draw();
    if (!raf) raf = requestAnimationFrame(tick);
  });

  document.documentElement.addEventListener('mouseleave', hide);
  window.addEventListener('blur', hide);
}
