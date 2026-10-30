// sim.js — where everyone is at any moment of the play.
// t always runs from 0 (snap) to 1 (end of play).

export function posAt(p, t) {
  if (!p) return { x: 0, y: 0 };
  const pts = [[p.start[0], p.start[1], 0], ...(p.path || [])];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (t <= b[2]) {
      const span = b[2] - a[2];
      const f = span > 0 ? Math.max(0, (t - a[2]) / span) : 1;
      return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f };
    }
  }
  const last = pts[pts.length - 1];
  return { x: last[0], y: last[1] };
}

// The ball: who has it, or where it is in the air.
export function ballAt(play, t) {
  const find = (id) => play.players.find((p) => p.id === id);
  const events = [...(play.ball || [])].sort((a, b) => a.t - b.t);
  let holder = find('QB') ? 'QB' : play.players[0]?.id;

  // The snap: ball travels from the center to the QB in the first moment.
  const center = find('C');
  const first = events[0];
  if (center && t < 0.06 && (!first || first.hold === 'QB')) {
    const from = posAt(center, 0);
    const to = posAt(find('QB'), 0.06);
    const f = t / 0.06;
    return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, air: false, lift: 0, holder: null };
  }

  for (const e of events) {
    if (e.t > t) break;
    if (e.hold && find(e.hold)) holder = e.hold;
    else if (e.throwTo && find(e.throwTo)) {
      if (t < e.arrive) {
        const from = posAt(find(holder), e.t);
        const to = posAt(find(e.throwTo), e.arrive);
        const f = (t - e.t) / (e.arrive - e.t);
        const dist = Math.hypot(to.x - from.x, to.y - from.y);
        return {
          x: from.x + (to.x - from.x) * f,
          y: from.y + (to.y - from.y) * f,
          air: true,
          lift: Math.sin(Math.PI * f) * Math.min(dist * 0.12, 2.5),
          holder: null
        };
      }
      holder = e.throwTo;
    }
  }
  const pos = posAt(find(holder), t);
  return { x: pos.x, y: pos.y, air: false, lift: 0, holder };
}

// ---------- Defense generator ----------
// Common youth fronts. dl/lb are x positions; s are [x, y] safety spots.
export const FRONTS = {
  '4-4': { dl: [-5, -1.5, 1.5, 5], lb: [-7, -2.5, 2.5, 7], lbDepth: 4.5, s: [[0, 11]] },
  '4-3': { dl: [-5, -1.5, 1.5, 5], lb: [-4, 0, 4], lbDepth: 5, s: [[-8, 11], [8, 11]] },
  '5-3': { dl: [-5, -2.5, 0, 2.5, 5], lb: [-4, 0, 4], lbDepth: 4.5, s: [[0, 11]] },
  '6-2': { dl: [-7, -4.5, -1.5, 1.5, 4.5, 7], lb: [-3, 3], lbDepth: 4.5, s: [[0, 10]] },
  '3-4': { dl: [-3.5, 0, 3.5], lb: [-7, -2.5, 2.5, 7], lbDepth: 4.5, s: [[-8, 11], [8, 11]] }
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// A play read from a sheet can keep the defense that was drawn on it.
export const SHEET_FRONT = 'From the sheet';
export const frontOptions = (play) => (play.defenseStarts?.length ? [SHEET_FRONT] : []).concat(Object.keys(FRONTS));

function defendersFromSheet(starts) {
  const isDL = ([x, y]) => y <= 2.2 && Math.abs(x) < 9;
  const dl = starts.filter(isDL).sort((a, b) => a[0] - b[0]);
  return starts.map(([x, y]) => {
    if (y >= 8) return { role: 'S', label: 'S', start: [x, y] };
    if (Math.abs(x) >= 9) return { role: 'CB', label: 'CB', start: [x, y] };
    if (isDL([x, y])) {
      const end = dl[0][0] === x || dl[dl.length - 1][0] === x;
      return { role: 'DL', label: end ? 'DE' : 'DT', start: [x, y] };
    }
    return { role: 'LB', label: 'LB', start: [x, y] };
  });
}

export function buildDefense(play, frontName) {
  const off = play.players;
  const duration = play.duration || 4;
  const throwE = (play.ball || []).find((e) => e.throwTo && e.arrive - e.t > 0.11);
  const isPass = !!throwE;
  let defenders = [];
  const wides = off.filter((p) => Math.abs(p.start[0]) >= 9);
  const leftW = wides.filter((p) => p.start[0] < 0).sort((a, b) => a.start[0] - b.start[0])[0];
  const rightW = wides.filter((p) => p.start[0] > 0).sort((a, b) => b.start[0] - a.start[0])[0];

  if (frontName === SHEET_FRONT && play.defenseStarts?.length) {
    defenders = defendersFromSheet(play.defenseStarts);
    // Each corner covers the wide receiver on his side.
    for (const d of defenders.filter((q) => q.role === 'CB')) d.man = (d.start[0] < 0 ? leftW : rightW)?.id;
  } else {
  const front = FRONTS[frontName] || FRONTS['4-4'];
  // Line up the defensive ends just outside the last player on each end of the line.
  const onLine = off.filter((p) => p.start[1] >= -1.4 && Math.abs(p.start[0]) < 9);
  const edgeL = Math.max(0, ...onLine.filter((p) => p.start[0] < 0).map((p) => -p.start[0]));
  const edgeR = Math.max(0, ...onLine.filter((p) => p.start[0] > 0).map((p) => p.start[0]));

  front.dl.forEach((x, i, arr) => {
    let dx = x;
    const end = i === 0 || i === arr.length - 1;
    if (i === 0) dx = Math.min(x, -(edgeL + 1.2));
    if (i === arr.length - 1) dx = Math.max(x, edgeR + 1.2);
    defenders.push({ role: 'DL', label: end ? 'DE' : x === 0 ? 'NT' : 'DT', start: [dx, 1] });
  });
  front.lb.forEach((x) => defenders.push({ role: 'LB', label: 'LB', start: [x, front.lbDepth] }));

  // Cornerbacks line up across from the widest receiver on each side.
  defenders.push({ role: 'CB', label: 'CB', start: leftW ? [leftW.start[0], 5] : [-12, 5], man: leftW?.id });
  defenders.push({ role: 'CB', label: 'CB', start: rightW ? [rightW.start[0], 5] : [12, 5], man: rightW?.id });
  front.s.forEach(([x, y]) => defenders.push({ role: 'S', label: 'S', start: [x, y] }));
  }

  // On passes, the nearest linebacker or safety covers each other receiver.
  if (isPass) {
    const covered = new Set([leftW?.id, rightW?.id]);
    for (const r of off.filter((p) => p.action === 'route' && !covered.has(p.id))) {
      const free = defenders.filter((d) => (d.role === 'LB' || d.role === 'S') && !d.man);
      if (!free.length) break;
      free.sort((a, b) => dist(a.start, r.start) - dist(b.start, r.start));
      free[0].man = r.id;
    }
  }
  defenders.forEach((d, i) => { d.id = `D${i + 1}`; });

  // Simulate the play in small time steps so defenders react to the ball.
  const N = 120;
  const dt = duration / N;
  const qb = off.find((p) => p.id === 'QB');
  const catchPt = isPass ? posAt(off.find((p) => p.id === throwE.throwTo), throwE.arrive) : null;

  for (const d of defenders) {
    let x = d.start[0];
    let y = d.start[1];
    const track = [[x, y]];
    const manP = d.man ? off.find((p) => p.id === d.man) : null;
    for (let k = 1; k <= N; k++) {
      const f = k / N;
      const s = f * duration;
      const ball = ballAt(play, f);
      const thrown = isPass && f >= throwE.t;
      let tx = x;
      let ty = y;
      let speed = 0;
      let stop = 0.9;

      if (d.role === 'DL') {
        // Linemen are tied up by blockers, so they move slowly toward the ball (or the QB on passes).
        const goal = isPass && !thrown && qb ? posAt(qb, f) : ball;
        tx = goal.x; ty = isPass ? goal.y : Math.max(goal.y, 0.3); speed = isPass ? 1.8 : 1.6; stop = 1.2;
      } else if (manP && !thrown && (isPass || f < 0.35)) {
        // Man coverage: stay a step and a half downfield of your receiver.
        const r = posAt(manP, f);
        tx = r.x; ty = r.y + 1.5; speed = 6.2; stop = 0.2;
      } else if (thrown && catchPt) {
        // Ball is in the air: break toward where it will be caught.
        tx = catchPt.x; ty = catchPt.y; speed = s < throwE.t * duration + 0.25 ? 3 : 6;
      } else if (isPass) {
        // Zone: drop back into your area and watch the quarterback.
        tx = d.start[0] * (d.role === 'LB' ? 1.1 : 0.8);
        ty = d.start[1] + (d.role === 'LB' ? 4 : 3);
        speed = 4; stop = 0.2;
      } else {
        // Run play: read it, then chase the ball carrier.
        const delay = d.role === 'LB' ? 0.45 : d.role === 'S' ? 0.7 : 0.6;
        // Stay on your side of the line and flow with the ball until the runner crosses it.
        if (s > delay) { tx = ball.x; ty = ball.y < 0.8 ? 0.8 : ball.y; speed = d.role === 'LB' ? 5 : 5.5; }
      }

      const dx = tx - x;
      const dy = ty - y;
      const dd = Math.hypot(dx, dy);
      if (dd > stop) {
        const m = Math.min(speed * dt, dd - stop);
        x += (dx / dd) * m;
        y += (dy / dd) * m;
      }
      track.push([x, y]);
    }
    d.track = track;
  }
  return defenders;
}

export function defPosAt(d, t) {
  const n = d.track.length - 1;
  const fi = Math.max(0, Math.min(1, t)) * n;
  const i = Math.floor(fi);
  const j = Math.min(n, i + 1);
  const f = fi - i;
  return {
    x: d.track[i][0] + (d.track[j][0] - d.track[i][0]) * f,
    y: d.track[i][1] + (d.track[j][1] - d.track[i][1]) * f
  };
}
