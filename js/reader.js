// reader.js — turns a play-sheet reading into a playable play:
// players with timed routes, the ball (handoff, toss or pass) at the right moment,
// and the defenders drawn on the sheet as the starting defense.

import { posAt, SHEET_FRONT } from './sim.js';
import { ACTIONS, PLAY_TYPES, suggestGoal } from './data.js';

export const SPEED = { block: 2.5, lead: 5, route: 6, carry: 6, handoff: 3, pass: 3, fake: 5 }; // yards per second
const ROLES = ['LT', 'LG', 'C', 'RG', 'RT', 'TE', 'TE2', 'SE', 'X', 'Z', 'H', 'Y', 'W', 'WB', 'QB', 'FB', 'TB', 'RB'];
const limit = (v, a, b) => Math.max(a, Math.min(b, v));

function pathSeconds(p) {
  const pts = [p.start, ...p.path];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return total / (SPEED[p.action] || 5);
}

// Give each route point a time based on distance and how fast that kind of player moves.
export function retime(p, duration) {
  const pts = [p.start, ...p.path];
  let total = 0;
  const times = [];
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    times.push(total / (SPEED[p.action] || 5));
  }
  const last = times[times.length - 1] || 0;
  const squeeze = last > duration ? duration / last : 1;
  p.path = p.path.map((pt, i) => [pt[0], pt[1], +Math.min(1, (times[i] * squeeze) / duration).toFixed(3)]);
}

export function ballPlan(play) {
  const ev = play.ball || [];
  const thrown = ev.find((e) => e.throwTo);
  const handed = ev.find((e) => e.hold && e.t > 0);
  if (thrown) return { type: thrown.arrive - thrown.t <= 0.11 ? 'pitch' : 'pass', to: thrown.throwTo, time: thrown.t };
  if (handed) return { type: 'handoff', to: handed.hold, time: handed.t };
  return { type: 'keep', to: '', time: 0.25 };
}

export function applyBall(play, plan) {
  const qb = play.players.find((p) => p.id === 'QB');
  const target = play.players.find((p) => p.id === plan.to);
  if (plan.type === 'keep' || !target || !qb) { play.ball = [{ t: 0, hold: 'QB' }]; return; }
  if (plan.type === 'handoff') {
    play.ball = [{ t: 0, hold: 'QB' }, { t: plan.time, hold: plan.to }];
    if (qb.action === 'pass') qb.action = 'handoff';
    return;
  }
  const a = posAt(qb, plan.time);
  const b = posAt(target, plan.time);
  const fly = plan.type === 'pitch' ? 0.1 : Math.max(0.12, Math.hypot(b.x - a.x, b.y - a.y) / 18 / (play.duration || 4));
  play.ball = [{ t: 0, hold: 'QB' }, { t: plan.time, throwTo: plan.to, arrive: Math.min(0.98, +(plan.time + fly).toFixed(3)) }];
  if (qb.action === 'handoff') qb.action = 'pass';
}

// When should the ball change hands? Worked out from the routes, not guessed.
function autoBallTime(play, type, toId) {
  const qb = play.players.find((p) => p.id === 'QB');
  const target = play.players.find((p) => p.id === toId);
  if (!qb || !target) return 0.2;
  if (type === 'pitch') return 0.12;
  if (type === 'handoff') {
    let best = 0.2;
    let bestD = Infinity;
    for (let t = 0.05; t <= 0.6; t += 0.01) {
      const a = posAt(qb, t);
      const b = posAt(target, t);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < bestD) { bestD = d; best = t; }
    }
    return +best.toFixed(2);
  }
  const routeEnd = target.path.length ? target.path[target.path.length - 1][2] : 0.6;
  return limit(+(routeEnd * 0.6).toFixed(2), 0.3, 0.75);
}

const cleanLabel = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

export function applyAiResult(p, json) {
  const used = new Set();
  const players = (json.players || []).filter((q) => Array.isArray(q.start)).slice(0, 11).map((q, i) => {
    const role = ROLES.includes(String(q.role || '').toUpperCase()) ? String(q.role).toUpperCase() : '';
    const label = cleanLabel(q.label) || role || `P${i + 1}`;
    let id = role || label;
    if (used.has(id)) id = role === 'TE' && !used.has('TE2') ? 'TE2' : `${label}${i}`;
    used.add(id);
    return {
      id,
      label,
      start: [limit(+q.start[0] || 0, -26.5, 26.5), limit(+q.start[1] || -1, -14.5, -0.8)],
      path: (q.path || []).filter(Array.isArray).slice(0, 10).map((pt) => [limit(+pt[0] || 0, -26.5, 26.5), limit(+pt[1] || 0, -14.5, 24.5)]),
      action: ACTIONS[q.action] ? q.action : 'block',
      job: {}
    };
  });
  if (players.length < 5) throw new Error('Couldn’t find enough players on this sheet. Try a clearer photo or place them by hand.');

  // The play lasts as long as its longest route takes to run.
  p.duration = limit(Math.round((Math.max(...players.map(pathSeconds)) + 0.4) * 2) / 2, 3.5, 7);
  players.forEach((pl) => retime(pl, p.duration));
  p.players = players;

  if (json.name) p.name = String(json.name).slice(0, 60);
  if (PLAY_TYPES[json.type]) p.type = json.type;
  if (json.formation) p.formation = String(json.formation).slice(0, 30);
  p.category = p.type === 'pass' || p.type === 'screen' ? 'Passes' : p.type === 'trick' ? 'Trick plays' : 'Runs';

  const b = json.ball || {};
  const toKey = cleanLabel(b.to);
  const target = players.find((pl) => pl.label === toKey || pl.id === toKey) || players.find((pl) => pl.action === 'carry');
  const type = ['handoff', 'pitch', 'pass', 'keep'].includes(b.type) ? b.type : target ? 'handoff' : 'keep';
  applyBall(p, { type, to: target?.id, time: autoBallTime(p, type, target?.id) });

  const def = (json.defense || []).filter(Array.isArray).slice(0, 11)
    .map((pt) => [limit(+pt[0] || 0, -26.5, 26.5), limit(+pt[1] || 1, 0.5, 14)]);
  if (def.length >= 5) { p.defenseStarts = def; p.front = SHEET_FRONT; } else { delete p.defenseStarts; }

  p.goal = (json.goal && String(json.goal).slice(0, 240)) || p.goal || suggestGoal(p);
  p.aiRead = true;
}
