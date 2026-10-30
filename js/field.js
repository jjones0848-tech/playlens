// field.js — draws the field, players, routes, and ball as SVG.
// 1 yard = 10 SVG units. The view shows 15 yards of backfield and 25 yards downfield.

import { posAt, ballAt, defPosAt } from './sim.js';

const SCALE = 10;
const HALF = 26.65;
const TOP = 25;
const BOTTOM = -15;
export const VIEW = { w: HALF * 2 * SCALE, h: (TOP - BOTTOM) * SCALE };
export const toSvg = (x, y) => [(x + HALF) * SCALE, (TOP - y) * SCALE];
export const fromSvg = (sx, sy) => [sx / SCALE - HALF, TOP - sy / SCALE];

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

export class FieldView {
  constructor(container, { onSelect, label = 'Football field' } = {}) {
    this.onSelect = onSelect;
    this.onTap = null;
    this.opts = { routes: true, labels: true, dim: true, selected: null, showDefense: true, defPaths: false };
    this.svg = el('svg', { viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, class: 'field-svg', role: 'group', 'aria-label': label });
    container.appendChild(this.svg);
    this.drawTurf();
    this.layers = {
      defRoutes: el('g', { class: 'def-routes' }, this.svg),
      routes: el('g', { class: 'routes' }, this.svg),
      marks: el('g', { class: 'marks' }, this.svg),
      players: el('g', { class: 'players' }, this.svg),
      ball: el('g', { class: 'ball' }, this.svg)
    };
    this.svg.addEventListener('click', (e) => {
      if (!this.onTap) return;
      const [x, y] = this.eventToField(e);
      this.onTap(x, y);
    });
  }

  eventToField(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(this.svg.getScreenCTM().inverse());
    return fromSvg(p.x, p.y);
  }

  drawTurf() {
    const g = el('g', { class: 'turf', 'aria-hidden': 'true' }, this.svg);
    const defs = el('defs', {}, this.svg);
    for (const [id, cls] of [['arrow-off', 'm-off'], ['arrow-you', 'm-you'], ['arrow-def', 'm-def']]) {
      const m = el('marker', { id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0 0L10 5L0 10z', class: cls }, m);
    }
    el('rect', { x: 0, y: 0, width: VIEW.w, height: VIEW.h, class: 'turf-base' }, g);
    for (let yd = BOTTOM; yd < TOP; yd += 5) {
      if (((yd - BOTTOM) / 5) % 2 === 1) {
        const [, sy] = toSvg(0, yd + 5);
        el('rect', { x: 0, y: sy, width: VIEW.w, height: 5 * SCALE, class: 'turf-stripe' }, g);
      }
    }
    for (let yd = BOTTOM + 5; yd < TOP; yd += 5) {
      if (yd === 0) continue;
      const [, sy] = toSvg(0, yd);
      el('line', { x1: 0, x2: VIEW.w, y1: sy, y2: sy, class: 'yard-line' }, g);
    }
    for (let yd = BOTTOM + 1; yd < TOP; yd++) {
      if (yd % 5 === 0) continue;
      const [, sy] = toSvg(0, yd);
      for (const hx of [-8.9, 8.9]) {
        const [sx] = toSvg(hx, 0);
        el('line', { x1: sx - 4, x2: sx + 4, y1: sy, y2: sy, class: 'hash' }, g);
      }
      el('line', { x1: 2, x2: 10, y1: sy, y2: sy, class: 'hash' }, g);
      el('line', { x1: VIEW.w - 10, x2: VIEW.w - 2, y1: sy, y2: sy, class: 'hash' }, g);
    }
    const [, los] = toSvg(0, 0);
    el('line', { x1: 0, x2: VIEW.w, y1: los, y2: los, class: 'los' }, g);
  }

  setPlay(play, defense = []) {
    this.play = play;
    this.defense = defense;
    for (const layer of Object.values(this.layers)) layer.replaceChildren();
    this.offEls = new Map();
    this.defEls = new Map();

    // Routes: arrows for runs/routes, a "T" for blocks (like a real playbook).
    for (const p of play.players) {
      if (!p.path.length) continue;
      const pts = [p.start, ...p.path].map(([x, y]) => toSvg(x, y));
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
      const g = el('g', { 'data-id': p.id, class: 'route' }, this.layers.routes);
      const isBlock = p.action === 'block' || p.action === 'lead';
      el('path', { d, class: `route-line${p.action === 'fake' ? ' fake' : ''}`, 'marker-end': isBlock ? '' : 'url(#arrow-off)' }, g);
      if (isBlock && pts.length > 1) {
        const [ax, ay] = pts[pts.length - 2];
        const [bx, by] = pts[pts.length - 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const nx = -(by - ay) / len * 7;
        const ny = (bx - ax) / len * 7;
        el('line', { x1: bx + nx, y1: by + ny, x2: bx - nx, y2: by - ny, class: 'route-line block-t' }, g);
      }
    }
    for (const d of defense) {
      const pts = d.track.filter((_, i) => i % 6 === 0 || i === d.track.length - 1).map(([x, y]) => toSvg(x, y));
      const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
      el('path', { d: path, class: 'def-route', 'marker-end': 'url(#arrow-def)' }, this.layers.defRoutes);
    }

    for (const d of defense) {
      const g = el('g', { class: 'player def', 'data-id': d.id }, this.layers.players);
      el('path', { d: 'M-9 -7L9 -7L0 9Z', class: 'def-shape' }, g);
      const t = el('text', { y: -1, class: 'def-label' }, g);
      t.textContent = d.label;
      this.defEls.set(d.id, g);
    }
    for (const p of play.players) {
      const g = el('g', { class: 'player off', 'data-id': p.id, tabindex: this.onSelect ? 0 : -1, role: this.onSelect ? 'button' : 'img', 'aria-label': p.label }, this.layers.players);
      el('circle', { r: 17, class: 'halo' }, g);
      el('circle', { r: 9.5, class: 'off-shape' }, g);
      const t = el('text', { y: 3, class: 'off-label' }, g);
      t.textContent = p.label;
      if (this.onSelect) {
        g.addEventListener('click', (e) => { if (this.onTap) return; e.stopPropagation(); this.onSelect(p.id); });
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.onSelect(p.id); } });
      }
      this.offEls.set(p.id, g);
    }

    el('ellipse', { class: 'ball-shadow', rx: 4, ry: 2 }, this.layers.ball);
    el('ellipse', { class: 'ball-body', rx: 4.6, ry: 3 }, this.layers.ball);
    this.applyOptions();
  }

  // Show only part of the field (in yards). Used to zoom in on the action.
  setView(x0, x1, y0, y1) {
    const [sx, sy] = toSvg(x0, y1);
    this.svg.setAttribute('viewBox', `${sx.toFixed(1)} ${sy.toFixed(1)} ${((x1 - x0) * SCALE).toFixed(1)} ${((y1 - y0) * SCALE).toFixed(1)}`);
  }

  setOptions(o) {
    Object.assign(this.opts, o);
    this.applyOptions();
  }

  applyOptions() {
    const { routes, labels, dim, selected, showDefense, defPaths } = this.opts;
    this.svg.classList.toggle('hide-routes', !routes);
    this.svg.classList.toggle('hide-labels', !labels);
    this.svg.classList.toggle('hide-defense', !showDefense);
    this.svg.classList.toggle('hide-def-routes', !defPaths);
    this.svg.classList.toggle('has-you', !!selected && dim);
    if (!this.offEls) return;
    for (const [id, g] of this.offEls) g.classList.toggle('you', id === selected);
    for (const r of this.layers.routes.children) {
      const you = r.getAttribute('data-id') === selected;
      r.classList.toggle('you', you);
      const line = r.querySelector('.route-line:not(.block-t)');
      if (line && line.getAttribute('marker-end')) line.setAttribute('marker-end', you ? 'url(#arrow-you)' : 'url(#arrow-off)');
    }
  }

  render(t) {
    if (!this.play) return;
    for (const p of this.play.players) {
      const { x, y } = posAt(p, t);
      const [sx, sy] = toSvg(x, y);
      this.offEls.get(p.id).setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
    }
    for (const d of this.defense) {
      const { x, y } = defPosAt(d, t);
      const [sx, sy] = toSvg(x, y);
      this.defEls.get(d.id).setAttribute('transform', `translate(${sx.toFixed(1)} ${sy.toFixed(1)})`);
    }
    const b = ballAt(this.play, t);
    const [bx, by] = toSvg(b.x, b.y);
    const [shadow, body] = this.layers.ball.children;
    const off = b.holder ? 6 : 0;
    shadow.setAttribute('cx', bx + off);
    shadow.setAttribute('cy', by + 2);
    shadow.style.opacity = b.air ? 0.35 : 0;
    body.setAttribute('cx', bx + off);
    body.setAttribute('cy', by - b.lift * SCALE * 0.8 - (b.holder ? 2 : 0));
  }

  // Quiz marks: the player's guess and the right answer.
  showMarks(marks) {
    this.layers.marks.replaceChildren();
    for (const m of marks) {
      const [sx, sy] = toSvg(m.x, m.y);
      if (m.kind === 'answer') {
        el('circle', { cx: sx, cy: sy, r: 40, class: 'mark-zone' }, this.layers.marks);
        el('circle', { cx: sx, cy: sy, r: 5, class: 'mark-answer' }, this.layers.marks);
      } else {
        el('path', { d: `M${sx - 7} ${sy - 7}L${sx + 7} ${sy + 7}M${sx + 7} ${sy - 7}L${sx - 7} ${sy + 7}`, class: 'mark-guess' }, this.layers.marks);
      }
    }
  }

  clearMarks() {
    this.layers.marks.replaceChildren();
  }
}
