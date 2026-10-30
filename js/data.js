// data.js — formations, positions, the "Your job" text helpers, and the sample playbook.
//
// COORDINATES (used everywhere in the app) are in yards:
//   x = left (−) / right (+) of the ball. The field is 53.3 yards wide, so x runs about −26.6 to +26.6.
//   y = distance from the line of scrimmage. Downfield (toward the defense) is +, the backfield is −.
// A player's "path" is a list of [x, y, t] points, where t is the moment (0 = snap, 1 = end of play).

export const CATEGORIES = ['Runs', 'Passes', 'Short yardage', 'Trick plays'];
export const PLAY_TYPES = { run: 'Run', pass: 'Pass', screen: 'Screen', trick: 'Trick' };

export const ACTIONS = {
  block: 'Block',
  lead: 'Lead block',
  route: 'Run a route',
  carry: 'Carry the ball',
  handoff: 'Hand off the ball',
  pass: 'Throw the pass',
  fake: 'Fake'
};

export const POSITIONS = {
  LT: 'Left tackle', LG: 'Left guard', C: 'Center', RG: 'Right guard', RT: 'Right tackle',
  TE: 'Tight end', TE2: 'Left tight end', X: 'Split end', Z: 'Flanker', H: 'Left slot', Y: 'Right slot',
  W: 'Wingback', WB: 'Wingback', SE: 'Split end', QB: 'Quarterback', FB: 'Fullback', RB: 'Running back', TB: 'Tailback'
};

export const positionName = (p) => POSITIONS[p.id] || p.label || p.id;

const OL = [['LT', -4, -1], ['LG', -2, -1], ['C', 0, -1], ['RG', 2, -1], ['RT', 4, -1]];

export const FORMATIONS = {
  'I-form': [...OL, ['TE', 6, -1], ['X', -18, -1], ['Z', 16, -2], ['QB', 0, -2], ['FB', 0, -4.5], ['RB', 0, -7]],
  'Shotgun 2x2': [...OL, ['X', -18, -1], ['H', -10, -2], ['Y', 10, -2], ['Z', 18, -1], ['QB', 0, -5], ['RB', 1.5, -5]],
  'Tight I': [...OL, ['TE2', -6, -1], ['TE', 6, -1], ['W', 8, -2], ['QB', 0, -2], ['FB', 0, -4.5], ['RB', 0, -7]]
};

const DEFAULT_ACTION = {
  LT: 'block', LG: 'block', C: 'block', RG: 'block', RT: 'block', TE: 'block', TE2: 'block', W: 'block',
  X: 'route', Z: 'route', H: 'route', Y: 'route', QB: 'handoff', FB: 'lead', RB: 'carry'
};

// Make 11 players from a formation template.
export function playersFromFormation(name) {
  return (FORMATIONS[name] || FORMATIONS['I-form']).map(([id, x, y]) => ({
    id, label: id, start: [x, y], path: [], action: DEFAULT_ACTION[id] || 'block', job: {}
  }));
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Build a play from a formation plus per-player moves.
function buildPlay({ moves, ...rest }) {
  const players = playersFromFormation(rest.formation).map((p) => {
    const m = moves[p.id] || {};
    return { ...p, path: m.path || [], action: m.action || p.action, job: m.job || {} };
  });
  return { status: 'ready', duration: 4, ...rest, players };
}

// ---------- Helpers that write kid-friendly "Your job" text ----------

const r1 = (n) => Math.round(n);

function directionWords(dx, dy) {
  const side = dx > 0.6 ? 'to the right' : dx < -0.6 ? 'to the left' : '';
  const fwd = dy > 0.6 ? 'forward' : dy < -0.6 ? 'back' : '';
  if (fwd && side) return `${fwd} and ${side}`;
  if (fwd) return fwd === 'forward' ? 'straight ahead' : 'straight back';
  return side || 'stay put';
}

export function alignText(p) {
  const [x, y] = p.start;
  const onLine = y >= -1.3;
  const side = Math.abs(x) < 0.6 ? 'right behind the ball' : `about ${r1(Math.abs(x))} yards to the ${x < 0 ? 'left' : 'right'} of the ball`;
  if (p.id === 'C') return 'Over the ball. You snap it to the quarterback.';
  if (onLine) return `On the line of scrimmage, ${side}.`;
  return `${r1(Math.abs(y))} yards off the ball, ${side}.`;
}

export function ballCarrier(play) {
  const ev = play.ball || [];
  const last = ev[ev.length - 1];
  if (!last) return 'QB';
  return last.throwTo || last.hold || 'QB';
}

export function passTarget(play) {
  const e = (play.ball || []).find((b) => b.throwTo && b.arrive - b.t > 0.11);
  return e ? e.throwTo : null;
}

export function routeShape(p) {
  const end = p.path.length ? p.path[p.path.length - 1] : [...p.start];
  const depth = end[1] - p.start[1];
  const lat = end[0] - p.start[0];
  const towardMiddle = Math.sign(lat) !== Math.sign(p.start[0]) && Math.abs(p.start[0]) > 1;
  const dir = Math.abs(lat) < 1.5 ? 'straight up the field' : towardMiddle ? 'toward the middle of the field' : 'toward the sideline';
  return { depth, lat, dir };
}

export function autoJob(play, p) {
  const players = play.players;
  const name = (id) => positionName(players.find((q) => q.id === id) || { id }).toLowerCase();
  const first = p.path[0];
  const words = first ? directionWords(first[0] - p.start[0], first[1] - p.start[1]) : '';
  const step = first ? `${words[0].toUpperCase()}${words.slice(1)}.` : 'Hold your spot.';
  const carrier = ballCarrier(play);
  const target = passTarget(play);
  let job = '';
  let watch = '';
  switch (p.action) {
    case 'block': {
      const end = p.path[p.path.length - 1];
      const dx = end ? end[0] - p.start[0] : 0;
      const where = Math.abs(dx) < 0.8 ? 'in front of you' : dx > 0 ? 'to your right' : 'to your left';
      job = play.type === 'pass' ? 'Stay between your defender and the quarterback. Keep him from getting to the QB.' : `Block the defender ${where} and keep him away from the ball.`;
      watch = 'Watch for a linebacker blitzing through your gap.';
      break;
    }
    case 'lead': {
      job = `Run ahead of the ${name(carrier)} and block the first defender who shows up in the hole.`;
      watch = 'Watch for the linebacker. He is usually your guy.';
      break;
    }
    case 'route': {
      const s = routeShape(p);
      const isTarget = target === p.id;
      job = `Run your route about ${Math.max(1, r1(s.depth))} yards downfield, then break ${s.dir}.` + (isTarget ? ' The ball is coming to you!' : ' Your route pulls defenders away from the ball.');
      watch = isTarget ? 'Turn your eyes back to the quarterback and catch with your hands.' : 'Keep running hard so the defense has to follow you.';
      break;
    }
    case 'carry': {
      const end = p.path[p.path.length - 1];
      const ex = end ? end[0] : 0;
      const hole = Math.abs(ex) < 1.5 ? 'up the middle' : Math.abs(ex) < 7 ? `between the ${ex > 0 ? 'right' : 'left'} guard and tackle` : `around the ${ex > 0 ? 'right' : 'left'} end`;
      job = p.id === 'QB' ? `Take the snap, keep the ball, and run ${hole}. Hold it tight with two hands in traffic.` : `Take the ball and run ${hole}. Hold it tight with two hands in traffic.`;
      watch = 'Follow your blockers, then cut up the field when you see daylight.';
      break;
    }
    case 'handoff': {
      if (carrier === p.id) { job = 'Take the snap and run with the ball yourself.'; watch = 'Follow your blockers and protect the ball.'; break; }
      job = `Take the snap and hand the ball to the ${name(carrier)}. Then keep running your fake.`;
      watch = 'Look the ball into his belly. Don’t rush the handoff.';
      break;
    }
    case 'pass': {
      job = target ? `Take the snap and throw to the ${name(target)}.` : 'Take the snap and find the open receiver.';
      watch = 'If he is covered, throw it away or run. Never throw into a crowd.';
      break;
    }
    case 'fake': {
      job = 'Pretend you have the ball so the defense chases you.';
      watch = 'Sell it! Run hard all the way, like you are carrying the ball.';
      break;
    }
    default:
      job = 'Do your assignment for this play.';
  }
  return { align: alignText(p), step, job, watch };
}

export function jobFor(play, p) {
  const a = autoJob(play, p);
  const j = p.job || {};
  return { align: j.align || a.align, step: j.step || a.step, job: j.job || a.job, watch: j.watch || a.watch };
}

export function suggestGoal(play) {
  const players = play.players;
  const name = (id) => positionName(players.find((q) => q.id === id) || { id }).toLowerCase();
  const target = passTarget(play);
  if (target) {
    const t = players.find((p) => p.id === target);
    const s = t ? routeShape(t) : { depth: 5 };
    return `Get the ball to the ${name(target)} on a ${s.depth > 12 ? 'deep' : 'short'} throw before the defense can reach the quarterback.`;
  }
  const c = players.find((p) => p.id === ballCarrier(play));
  const end = c && c.path.length ? c.path[c.path.length - 1] : [0, 0];
  const where = Math.abs(end[0]) < 1.5 ? 'straight up the middle' : Math.abs(end[0]) < 7 ? `through the ${end[0] > 0 ? 'right' : 'left'} side of the line` : `around the ${end[0] > 0 ? 'right' : 'left'} end`;
  return `Get the ${c ? positionName(c).toLowerCase() : "ball carrier"} ${where} for 4 or more yards.`;
}

// Important moments in the play, used by the step buttons.
export function keyframes(play) {
  const set = new Set([0, 1]);
  for (const e of play.ball || []) {
    if (e.t > 0) set.add(e.t);
    if (e.arrive) set.add(e.arrive);
  }
  return [...set].sort((a, b) => a - b);
}

export function phaseLabel(play, t) {
  if (t <= 0.001) return 'Before the snap';
  if (t >= 0.999) return 'Whistle — end of the play';
  let label = 'Snap';
  for (const e of play.ball || []) {
    if (e.hold && e.t > 0 && t >= e.t) label = `Handoff to ${e.hold}`;
    if (e.throwTo && t >= e.t) label = t < e.arrive ? `Ball in the air to ${e.throwTo}` : `${e.throwTo} has the ball`;
  }
  return label;
}

// ---------- Sample playbook ----------

export const SAMPLE_PLAYS = [
  buildPlay({
    id: 'sample-power-right', number: 12, name: 'Power Right', category: 'Runs', formation: 'I-form', type: 'run',
    snap: 'On two', front: '4-4',
    goal: 'Get the running back through the hole between the right guard and right tackle for 4 or more yards.',
    ball: [{ t: 0, hold: 'QB' }, { t: 0.2, hold: 'RB' }],
    moves: {
      LT: { path: [[-4.5, 0.2, 0.25], [-4.5, 1, 1]] },
      LG: { path: [[-2, 0.3, 0.25], [-1.5, 1.2, 1]] },
      C: { path: [[0.5, 0.4, 0.25], [0.8, 1.4, 1]] },
      RG: { path: [[1.8, 0.4, 0.25], [2, 1.5, 1]], job: { job: 'Block the defender over you and push him to the left. You are opening the hole on your right.' } },
      RT: { path: [[5, 0.3, 0.25], [5.5, 1.2, 1]], job: { job: 'Block the defender to your right and push him outside. The hole opens on your left.' } },
      TE: { path: [[7, 0.8, 0.3], [7.5, 2, 1]] },
      X: { action: 'block', path: [[-18, 3, 0.4], [-18, 4, 1]], job: { job: 'Run at the cornerback like it is a pass, then block him.' } },
      Z: { action: 'block', path: [[16, 3, 0.4], [15, 5, 1]], job: { job: 'Run at the cornerback, then block him so he can’t chase the running back.' } },
      QB: { path: [[0.6, -3.3, 0.15], [0.9, -3.8, 0.25], [-2, -5, 1]] },
      FB: { path: [[1.5, -2.5, 0.18], [3.5, 0, 0.38], [3.5, 3, 0.7], [3.5, 4, 1]] },
      RB: { path: [[0.8, -4.6, 0.18], [3, -1.5, 0.38], [3.5, 1.5, 0.55], [4, 8, 1]], job: { job: 'Take the handoff and follow the fullback through the hole between the right guard and right tackle.' } }
    }
  }),
  buildPlay({
    id: 'sample-toss-left', number: 14, name: 'Toss Sweep Left', category: 'Runs', formation: 'I-form', type: 'run',
    snap: 'On one', front: '4-4',
    goal: 'Pitch the ball to the running back and get around the left end, outside the defensive end, for a big gain.',
    ball: [{ t: 0, hold: 'QB' }, { t: 0.1, throwTo: 'RB', arrive: 0.2 }],
    moves: {
      LT: { path: [[-5, 0.2, 0.25], [-6, 1, 1]] },
      LG: { path: [[-3, 0.2, 0.25], [-4, 1, 1]] },
      C: { path: [[-1, 0.2, 0.25], [-2, 1, 1]] },
      RG: { path: [[1, 0.2, 0.25], [0, 1, 1]] },
      RT: { path: [[3, 0.3, 0.3], [2.5, 1, 1]] },
      TE: { path: [[5, 0.5, 0.3], [4.5, 1.5, 1]] },
      X: { action: 'block', path: [[-17, 2.5, 0.3], [-15.5, 4, 1]], job: { job: 'Block the cornerback and push him toward the middle so the running back can get outside.' } },
      Z: { path: [[16, 6, 0.5], [14, 11, 1]], job: { job: 'Run deep so your defender follows you away from the play.' } },
      QB: { action: 'pass', path: [[-1.2, -2.6, 0.1], [-0.8, -3.2, 0.3], [-0.5, -3.5, 1]], job: { job: 'Take the snap, turn left, and pitch the ball softly to the running back.', watch: 'Pitch it out in front of him so he can run to it.' } },
      FB: { path: [[-3, -4, 0.15], [-7, -2, 0.4], [-9.5, 1, 0.65], [-10.5, 4, 1]], job: { job: 'Sprint to the left and block the first defender outside the tight end side.' } },
      RB: { path: [[-3, -7.2, 0.12], [-6.5, -6, 0.3], [-10, -2, 0.5], [-12.5, 3, 0.72], [-13, 11, 1]], job: { job: 'Catch the pitch while running left, stay behind the fullback, and turn up the field outside.' } }
    }
  }),
  buildPlay({
    id: 'sample-quick-slants', number: 20, name: 'Quick Slants', category: 'Passes', formation: 'Shotgun 2x2', type: 'pass',
    snap: 'On one', front: '4-3', duration: 4.5,
    goal: 'Get the ball out fast to a receiver slanting inside before the defense can rush the quarterback.',
    ball: [{ t: 0, hold: 'QB' }, { t: 0.3, throwTo: 'Z', arrive: 0.45 }],
    moves: {
      LT: { path: [[-4, -1.8, 0.2], [-4, -2, 1]] },
      LG: { path: [[-2, -1.8, 0.2], [-2, -2, 1]] },
      C: { path: [[0, -1.8, 0.2], [0, -2, 1]] },
      RG: { path: [[2, -1.8, 0.2], [2, -2, 1]] },
      RT: { path: [[4, -1.8, 0.2], [4, -2, 1]] },
      QB: { action: 'pass', path: [[0, -6, 0.2], [0, -6, 1]] },
      RB: { action: 'block', path: [[1.5, -4, 0.25], [1.5, -4, 1]], job: { job: 'Stay in and block any defender who rushes at the quarterback.' } },
      X: { path: [[-18, 1, 0.12], [-16.5, 3, 0.3], [-12.5, 6, 0.55], [-8, 9, 1]] },
      Z: { path: [[18, 1, 0.12], [16.5, 3, 0.3], [12.5, 6, 0.55], [8, 9, 1]], job: { job: 'Take three hard steps up the field, then slant toward the middle. The ball is coming to you fast!' } },
      H: { path: [[-12, -1.2, 0.2], [-15, 0, 0.45], [-17, 1, 1]] },
      Y: { path: [[10, 5, 0.35], [10, 11, 0.7], [10, 15, 1]] }
    }
  }),
  buildPlay({
    id: 'sample-boot-right', number: 24, name: 'Play Action Boot Right', category: 'Passes', formation: 'I-form', type: 'pass',
    snap: 'On two', front: '5-3', duration: 4.5,
    goal: 'Fake the run left so the defense bites, then the quarterback rolls right and throws to the fullback in the flat.',
    ball: [{ t: 0, hold: 'QB' }, { t: 0.62, throwTo: 'FB', arrive: 0.74 }],
    moves: {
      LT: { path: [[-5, 0.1, 0.3], [-5.5, 0.6, 1]] },
      LG: { path: [[-3, 0.1, 0.3], [-3.5, 0.6, 1]] },
      C: { path: [[-1, 0.1, 0.3], [-1.5, 0.6, 1]] },
      RG: { path: [[1, 0.1, 0.3], [0.5, 0.6, 1]] },
      RT: { path: [[3, 0.1, 0.3], [2.5, 0.6, 1]] },
      TE: { action: 'route', path: [[5.5, 2, 0.25], [3, 5, 0.5], [-5, 6.5, 1]] },
      QB: { action: 'pass', path: [[-1, -2.8, 0.15], [-1.5, -3.8, 0.3], [3, -4.5, 0.5], [6.5, -3.5, 0.65], [8, -3, 1]], job: { job: 'Fake the handoff to the running back, hide the ball on your hip, and roll out to the right.', watch: 'Throw to the fullback in the flat. If he is covered, run.' } },
      RB: { action: 'fake', path: [[-2, -5.2, 0.2], [-5, -1.5, 0.45], [-6.5, 1, 1]] },
      FB: { action: 'route', path: [[2, -3.5, 0.2], [6, -2, 0.4], [11, -0.3, 0.7], [14, 0.5, 1]], job: { job: 'Run across the backfield to the right and out to the flat. The ball is coming to you.' } },
      Z: { path: [[16, 9, 0.45], [18.5, 11, 0.62], [19, 11, 1]] },
      X: { path: [[-18, 8, 0.4], [-12, 16, 0.8], [-10, 20, 1]] }
    }
  }),
  buildPlay({
    id: 'sample-wedge', number: 30, name: 'Wedge', category: 'Short yardage', formation: 'Tight I', type: 'run',
    snap: 'On one', front: '6-2',
    goal: 'Everyone squeezes into a tight wedge behind the center and pushes straight ahead for a short gain.',
    ball: [{ t: 0, hold: 'QB' }, { t: 0.25, hold: 'RB' }],
    moves: {
      LT: { path: [[-2.5, 0, 0.3], [-2, 3, 1]], job: { job: 'Step toward the center, put your shoulder on the guard’s hip, and push forward together.' } },
      LG: { path: [[-1.2, 0, 0.3], [-1, 3, 1]] },
      C: { path: [[0, 0.3, 0.3], [0, 3.3, 1]], job: { job: 'Snap the ball and drive straight ahead. You are the point of the wedge.' } },
      RG: { path: [[1.2, 0, 0.3], [1, 3, 1]] },
      RT: { path: [[2.5, 0, 0.3], [2, 3, 1]], job: { job: 'Step toward the center, put your shoulder on the guard’s hip, and push forward together.' } },
      TE2: { path: [[-3.5, -0.3, 0.3], [-3, 2.5, 1]] },
      TE: { path: [[3.5, -0.3, 0.3], [3, 2.5, 1]] },
      W: { path: [[5, -0.5, 0.3], [4, 2, 1]] },
      FB: { path: [[0, -1.6, 0.25], [0, 2.4, 1]] },
      RB: { path: [[0, -4.2, 0.25], [0, -2, 0.45], [0.3, 4.5, 1]], job: { job: 'Take the handoff, get low, and stay right behind the wedge. Keep your legs driving.' } },
      QB: { path: [[0, -2.8, 0.2], [-1.5, -3.5, 1]] }
    }
  })
];
