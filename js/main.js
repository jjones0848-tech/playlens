// main.js — starts the app and draws each screen.
// Screens (the part after # in the address bar):
//   #/            playbook (wristband list)
//   #/play/ID     learn a play
//   #/edit/ID     coach editor
//   #/import      import files or photos
//   #/settings    settings

import { getPlays, savePlay, deletePlay, kvGet, kvSet } from './store.js';
import { SAMPLE_PLAYS, CATEGORIES, PLAY_TYPES, ACTIONS, positionName, jobFor, keyframes, phaseLabel, playersFromFormation, uid } from './data.js';
import { FieldView } from './field.js';
import { buildDefense, frontOptions, posAt, defPosAt } from './sim.js';
import { applyAiResult } from './reader.js';
import { aiAvailable, readPlayWithAI } from './ai.js';
import { renderEditor } from './editor.js';
import { importFiles, draftFromPage } from './importer.js';
import { esc, toast } from './util.js';

const state = {
  plays: [],
  settings: { coach: false, apiKey: '', model: 'claude-sonnet-5-5' },
  progress: {}
};
const app = document.getElementById('app');
let cleanup = null;

// ---------- Data helpers ----------
async function save(play) {
  await savePlay(play);
  const i = state.plays.findIndex((p) => p.id === play.id);
  if (i >= 0) state.plays[i] = play; else state.plays.push(play);
}
async function remove(id) {
  await deletePlay(id);
  state.plays = state.plays.filter((p) => p.id !== id);
}
const saveSettings = () => kvSet('settings', state.settings);
const nextNumber = () => Math.max(0, ...state.plays.map((p) => +p.number || 0)) + 1;

function recordProgress(playId, pos, score) {
  const rec = (state.progress[playId] ||= {});
  const cur = (rec[pos] ||= { views: 0, best: null });
  if (score == null) cur.views += 1; else cur.best = Math.max(cur.best ?? 0, score);
  kvSet('progress', state.progress);
}

// ---------- Router ----------
function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const [, view, id] = (location.hash || '#/').split('/');
  document.body.classList.toggle('coach', state.settings.coach);
  const coachBtn = document.getElementById('coachToggle');
  coachBtn.setAttribute('aria-pressed', String(state.settings.coach));
  window.scrollTo(0, 0);

  if (view === 'play') return renderViewer(decodeURIComponent(id || ''));
  if (view === 'edit') {
    const play = state.plays.find((p) => p.id === decodeURIComponent(id || ''));
    if (!play) return renderMissing();
    cleanup = renderEditor(app, play, { save, remove, toast, settings: state.settings });
    return;
  }
  if (view === 'import') return renderImport();
  if (view === 'settings') return renderSettings();
  return renderHome();
}

function renderMissing() {
  app.innerHTML = `<section class="empty"><h1>That play isn’t in your playbook</h1><p>It may have been deleted.</p><a class="btn primary" href="#/">Back to the playbook</a></section>`;
}

// ---------- Home: the wristband ----------
function renderHome() {
  const ready = state.plays.filter((p) => p.status !== 'draft').sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
  const drafts = state.plays.filter((p) => p.status === 'draft');
  const cats = [...CATEGORIES, ...new Set(ready.map((p) => p.category).filter((c) => !CATEGORIES.includes(c)))];
  const studied = (id) => Object.values(state.progress[id] || {}).some((r) => r.views > 0);

  const groups = cats.map((cat) => {
    const plays = ready.filter((p) => (p.category || 'Runs') === cat);
    if (!plays.length) return '';
    return `<div class="band-group">
      <h2>${esc(cat)}</h2>
      <ol class="calls">${plays.map((p) => `
        <li><a href="#/play/${encodeURIComponent(p.id)}">
          <span class="num">${esc(p.number ?? '')}</span>
          <span class="call-name">${esc(p.name)}<small>${esc(PLAY_TYPES[p.type] || '')} from ${esc(p.formation || 'custom')}</small></span>
          ${studied(p.id) ? '<span class="studied" title="You studied this play">Studied</span>' : ''}
        </a></li>`).join('')}
      </ol></div>`;
  }).join('');

  app.innerHTML = `
  <section class="home">
    <div class="hero">
      <h1 class="wordmark">PlayLens</h1>
      <p class="tagline">See the whole play. Know your job.</p>
    </div>
    <div class="coach-only coach-bar">
      <a class="btn primary" href="#/import">Import a playbook</a>
      <label class="btn">Snap a play sheet<input type="file" accept="image/*" capture="environment" multiple hidden id="snapInput"></label>
      <button class="btn" data-act="new">Draw a new play</button>
    </div>
    ${drafts.length ? `<div class="coach-only drafts card">
      <h2>Needs review</h2>
      <p class="small-note">These plays came from files or photos. Check each one before players see it.</p>
      <ul>${drafts.map((d) => `<li><a href="#/edit/${encodeURIComponent(d.id)}">${esc(d.name)}</a></li>`).join('')}</ul>
    </div>` : ''}
    ${ready.length ? `<div class="wristband">${groups}</div>` : `
      <div class="empty card"><h2>No plays yet</h2><p>Turn on coach tools at the top of the page, then import a playbook or snap a photo of a play sheet.</p></div>`}
  </section>`;

  app.querySelector('[data-act="new"]')?.addEventListener('click', async () => {
    const play = { id: uid(), number: nextNumber(), name: 'New play', category: 'Runs', formation: 'I-form', type: 'run', snap: '', goal: '', duration: 4, front: '4-4', status: 'draft', ball: [{ t: 0, hold: 'QB' }], players: playersFromFormation('I-form') };
    await save(play);
    location.hash = `#/edit/${play.id}`;
  });
  app.querySelector('#snapInput')?.addEventListener('change', (e) => {
    const files = [...e.target.files];
    location.hash = '#/import';
    setTimeout(() => runImport(files, document.getElementById('importStatus')), 60);
  });
}

// ---------- Import ----------
async function runImport(files, statusEl) {
  if (!files.length) return;
  const say = (m) => { if (statusEl) statusEl.textContent = m; else toast(m); };
  const res = await importFiles(files, say);
  let n = nextNumber();
  const drafts = [];
  for (const page of res.pages) { const d = draftFromPage(page, n++); drafts.push(d); await save(d); }
  for (const play of res.plays) { await save({ ...play, number: play.number ?? n++ }); }

  // Read each new play automatically: players, routes, ball and defense.
  let read = 0;
  if (drafts.length && (await aiAvailable(state.settings))) {
    statusEl?.classList.add('working');
    for (const [i, d] of drafts.entries()) {
      say(`Reading play ${i + 1} of ${drafts.length}: finding every player and route…`);
      try {
        applyAiResult(d, await readPlayWithAI(d.sourceImage, state.settings));
        delete d.readError;
        read++;
      } catch (err) {
        d.readError = err.message || 'The sheet couldn’t be read.';
      }
      d.readTried = true;
      await save(d);
    }
    statusEl?.classList.remove('working');
  }
  const total = drafts.length + res.plays.length;
  const readNote = drafts.length ? (read === drafts.length ? ' PlayLens placed every player and route.' : read ? ` PlayLens read ${read} of them; place the rest by hand.` : '') : '';
  say(total ? `Added ${total} play${total === 1 ? '' : 's'}.${readNote}` : 'No plays were added.');
  if (res.errors.length) {
    const box = document.getElementById('importErrors');
    if (box) box.innerHTML = res.errors.map((er) => `<li>${esc(er)}</li>`).join('');
    else toast(res.errors[0]);
  }
  if (drafts.length) location.hash = `#/edit/${drafts[0].id}`;
  else if (res.plays.length) location.hash = '#/';
}

function renderImport() {
  app.innerHTML = `
  <section class="import">
    <div class="viewer-top"><a href="#/" class="back">Playbook</a><h1>Import a playbook</h1></div>
    <label class="dropzone" id="drop">
      <input type="file" id="fileInput" multiple accept=".pdf,.pptx,.docx,.json,image/*" hidden>
      <strong>Drop files here or choose files</strong>
      <span>PDF, PowerPoint, Word, photos and pictures, or a PlayLens playbook file (.json)</span>
    </label>
    <div class="import-actions">
      <label class="btn">Take a photo of a play sheet<input type="file" accept="image/*" capture="environment" multiple hidden id="snap2"></label>
    </div>
    <p class="small-note" id="aiNote"></p>
    <p class="status" id="importStatus" role="status" aria-live="polite"></p>
    <ul class="errors" id="importErrors"></ul>
    <div class="card tips">
      <h2>Tips for good results</h2>
      <ul>
        <li>One play per page or per photo works best.</li>
        <li>Photograph the sheet flat, in good light, from straight above.</li>
        <li>Clear labels (LT, QB1, TB2…), arrows and a highlighted ball carrier read best.</li>
        <li>Every imported play opens in the editor so you can check it before players see it.</li>
      </ul>
    </div>
  </section>`;
  const status = app.querySelector('#importStatus');
  const drop = app.querySelector('#drop');
  aiAvailable(state.settings).then((ok) => {
    const note = app.querySelector('#aiNote');
    if (note) note.textContent = ok
      ? 'PlayLens reads each play sheet and places every player, route and defender for you.'
      : 'Add an API key in Settings and PlayLens will place every player and route for you. Without one, you place them in the editor.';
  });
  app.querySelector('#fileInput').addEventListener('change', (e) => runImport([...e.target.files], status));
  app.querySelector('#snap2').addEventListener('change', (e) => runImport([...e.target.files], status));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); runImport([...e.dataTransfer.files], status); });
}

// ---------- Settings ----------
function renderSettings() {
  const s = state.settings;
  app.innerHTML = `
  <section class="settings">
    <div class="viewer-top"><a href="#/" class="back">Playbook</a><h1>Settings</h1></div>
    <div class="card">
      <h2>Coach tools</h2>
      <label class="check"><input type="checkbox" id="setCoach"${s.coach ? ' checked' : ''}> Show import and editing tools on this device</label>
    </div>
    <div class="card">
      <h2>Read play sheets with AI (optional)</h2>
      <p class="small-note">Paste an Anthropic API key to let PlayLens place players and routes from a photo. The key is saved only in this browser. Don’t turn this on for players’ devices.</p>
      <div class="field-row"><label for="setKey">API key</label><input id="setKey" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="sk-ant-…"></div>
      <div class="field-row"><label for="setModel">Model</label><input id="setModel" value="${esc(s.model)}"></div>
      <button class="btn small" id="saveAi">Save AI settings</button>
    </div>
    <div class="card">
      <h2>Share your playbook</h2>
      <p class="small-note">Download the playbook as a file. Players can import it on their own device from the Import screen.</p>
      <button class="btn small" id="exportBtn">Download playbook file</button>
    </div>
    <div class="card">
      <h2>Sample plays</h2>
      <p class="small-note">Add the five sample plays back to your playbook.</p>
      <button class="btn small" id="samplesBtn">Add sample plays</button>
    </div>
  </section>`;
  app.querySelector('#setCoach').addEventListener('change', (e) => { s.coach = e.target.checked; saveSettings(); document.body.classList.toggle('coach', s.coach); document.getElementById('coachToggle').setAttribute('aria-pressed', String(s.coach)); });
  app.querySelector('#saveAi').addEventListener('click', () => { s.apiKey = app.querySelector('#setKey').value.trim(); s.model = app.querySelector('#setModel').value.trim() || 'claude-sonnet-5-5'; saveSettings(); toast('AI settings saved'); });
  app.querySelector('#exportBtn').addEventListener('click', () => {
    const plays = state.plays.filter((p) => p.status !== 'draft').map(({ sourceImage, ...rest }) => rest);
    const blob = new Blob([JSON.stringify({ app: 'PlayLens', version: 1, plays }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'playlens-playbook.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  app.querySelector('#samplesBtn').addEventListener('click', async () => {
    for (const p of SAMPLE_PLAYS) await save(structuredClone(p));
    toast('Sample plays added');
  });
}

// ---------- Viewer: learn a play ----------
function renderViewer(id) {
  const play = state.plays.find((p) => p.id === id);
  if (!play) return renderMissing();
  const duration = play.duration || 4;
  let front = play.front || '4-4';
  let defense = buildDefense(play, front);
  let selected = null;
  let t = 0;
  let playing = false;
  let speed = 0.5;
  let raf = 0;
  let last = 0;
  const kfs = keyframes(play);
  let closeUp = window.matchMedia('(max-width: 700px)').matches;

  app.innerHTML = `
  <section class="viewer">
    <div class="viewer-top">
      <a href="#/" class="back">Playbook</a>
      <h1><span class="call-num">${esc(play.number ?? '')}</span> ${esc(play.name)}</h1>
      <span class="chip chip-${esc(play.type)}">${esc(PLAY_TYPES[play.type] || 'Play')}</span>
      <a class="btn small coach-only" href="#/edit/${encodeURIComponent(play.id)}">Edit play</a>
    </div>
    <div class="viewer-grid">
      <div class="stage">
        <div class="who" id="who">
          <p class="who-q">Who are you? Tap your position.</p>
          <div class="pos-chips">${play.players.map((p) => `<button class="pos-chip" data-pos="${esc(p.id)}"><b>${esc(p.label)}</b> ${esc(positionName(p))}</button>`).join('')}</div>
          <button class="linkish" data-act="watch">Just watch the play</button>
        </div>
        <div class="field view-field" id="field"></div>
        <div class="legend" aria-hidden="true"><span><i class="lg-off"></i>Offense</span><span><i class="lg-def"></i>Defense</span><span><i class="lg-you"></i>You</span><span><i class="lg-los"></i>Line of scrimmage</span></div>
        <div class="controls">
          <div class="transport">
            <button class="icon-btn" data-act="restart" aria-label="Back to the snap" title="Back to the snap">⏮</button>
            <button class="icon-btn" data-act="back" aria-label="Previous moment" title="Previous moment">◀︎</button>
            <button class="icon-btn play-btn" data-act="toggle" aria-label="Play">▶︎</button>
            <button class="icon-btn" data-act="fwd" aria-label="Next moment" title="Next moment">▶︎▶︎</button>
            <button class="btn small zoom-btn" data-act="zoom" aria-pressed="false">Close up</button>
            <div class="seg speed" role="group" aria-label="Speed">
              ${[0.25, 0.5, 1].map((s) => `<button data-speed="${s}" aria-pressed="${s === speed}">${s}×</button>`).join('')}
            </div>
          </div>
          <input type="range" id="scrub" min="0" max="1000" value="0" aria-label="Play timeline">
          <p class="phase" id="phase" aria-live="polite">Before the snap</p>
          <div class="toggles">
            <label class="check"><input type="checkbox" data-opt="routes" checked> Routes</label>
            <label class="check"><input type="checkbox" data-opt="labels" checked> Labels</label>
            <label class="check"><input type="checkbox" data-opt="showDefense" checked> Defense</label>
            <label class="check"><input type="checkbox" data-opt="defPaths"> Defense paths</label>
          </div>
        </div>
      </div>
      <aside class="side">
        <div class="card goal" id="goalCard">
          <h2>Goal of the play</h2>
          <p>${esc(play.goal || 'Your coach hasn’t written a goal for this play yet.')}</p>
          ${play.snap ? `<p class="small-note">Snap count: ${esc(play.snap)}</p>` : ''}
        </div>
        <div class="card job" id="jobCard" hidden></div>
        <div class="card quiz" id="quizCard" hidden></div>
        <div class="card">
          <h2>Defense</h2>
          <div class="field-row"><label for="frontSel">Defensive front</label>
            <select id="frontSel">${frontOptions(play).map((f) => `<option${f === front ? ' selected' : ''}>${f}</option>`).join('')}</select></div>
          <p class="small-note">${play.defenseStarts ? 'The first choice is the defense drawn on your sheet. Their movement is an example; real opponents may react differently.' : 'This is an example of a common defense. Real opponents may line up differently.'}</p>
        </div>
        <button class="btn primary wide" data-act="quiz">Test yourself</button>
      </aside>
    </div>
  </section>`;

  const $ = (s) => app.querySelector(s);
  const fv = new FieldView($('#field'), { onSelect: (pid) => choose(pid), label: `${play.name} on the field` });
  fv.setPlay(play, defense);
  fitView();
  setT(0);

  // Zoom the field to where the action happens. Close up = 26 yards wide, centered on your player.
  function fitView() {
    const xs = [];
    const ys = [];
    for (let k = 0; k <= 8; k++) {
      const tt = k / 8;
      for (const p of play.players) { const q = posAt(p, tt); xs.push(q.x); ys.push(q.y); }
      for (const d of defense) { const q = defPosAt(d, tt); xs.push(q.x); ys.push(q.y); }
    }
    let y0 = Math.max(-15, Math.min(...ys) - 2.5);
    let y1 = Math.min(25, Math.max(...ys) + 2.5);
    if (y1 - y0 < 16) { const mid = (y0 + y1) / 2; y0 = Math.max(-15, mid - 8); y1 = Math.min(25, y0 + 16); }
    let x0 = Math.max(-26.65, Math.min(...xs) - 3);
    let x1 = Math.min(26.65, Math.max(...xs) + 3);
    if (closeUp) {
      const me = play.players.find((p) => p.id === selected);
      let cx = 0;
      if (me) { let sum = 0; for (let k = 0; k <= 8; k++) sum += posAt(me, k / 8).x; cx = sum / 9; }
      const w = 26;
      x0 = Math.max(-26.65, Math.min(26.65 - w, cx - w / 2));
      x1 = x0 + w;
    }
    fv.setView(x0, x1, y0, y1);
    const zb = app.querySelector('[data-act="zoom"]');
    zb.setAttribute('aria-pressed', String(closeUp));
    zb.textContent = closeUp ? 'Whole play' : 'Close up';
  }

  function setT(v) {
    t = Math.max(0, Math.min(1, v));
    fv.render(t);
    $('#scrub').value = Math.round(t * 1000);
    $('#phase').textContent = phaseLabel(play, t);
  }
  function updatePlayBtn() {
    const b = $('.play-btn');
    b.textContent = playing ? '❚❚' : '▶︎';
    b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  function tick(now) {
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    let nt = t + (dt * speed) / duration;
    if (nt >= 1) { nt = 1; playing = false; updatePlayBtn(); $('#goalCard').classList.add('flash'); setTimeout(() => $('#goalCard')?.classList.remove('flash'), 1600); }
    setT(nt);
    if (playing) raf = requestAnimationFrame(tick);
  }
  function start() { if (t >= 1) setT(0); playing = true; last = performance.now(); raf = requestAnimationFrame(tick); updatePlayBtn(); }
  function pause() { playing = false; cancelAnimationFrame(raf); updatePlayBtn(); }

  function choose(pid) {
    if (fv.onTap) return;
    selected = pid;
    const p = play.players.find((q) => q.id === pid);
    fv.setOptions({ selected: pid });
    fitView();
    $('#who').classList.add('done');
    const j = jobFor(play, p);
    const card = $('#jobCard');
    card.hidden = false;
    card.innerHTML = `
      <h2>Your job: ${esc(positionName(p))}</h2>
      <dl>
        <dt>Line up</dt><dd>${esc(j.align)}</dd>
        <dt>First step</dt><dd>${esc(j.step)}</dd>
        <dt>Your job</dt><dd>${esc(j.job)}</dd>
        <dt>Watch for</dt><dd>${esc(j.watch)}</dd>
      </dl>
      <button class="linkish" data-act="change">Pick a different position</button>`;
    recordProgress(play.id, pid, null);
  }

  // ---- Quiz ----
  function startQuiz() {
    if (!selected) { toast('Pick your position first, then test yourself.'); $('#who').classList.remove('done'); return; }
    pause();
    setT(0);
    const p = play.players.find((q) => q.id === selected);
    const card = $('#quizCard');
    let score = 0;
    fv.setOptions({ routes: false });
    card.hidden = false;
    card.innerHTML = `<h2>Question 1 of 2</h2><p>Where do you end up when the whistle blows? Tap the spot on the field.</p>`;
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    fv.onTap = (x, y) => {
      fv.onTap = null;
      const end = posAt(p, 1);
      const ok = Math.hypot(x - end.x, y - end.y) <= 4;
      score += ok ? 1 : 0;
      fv.showMarks([{ x: end.x, y: end.y, kind: 'answer' }, { x, y, kind: 'guess' }]);
      fv.setOptions({ routes: true });
      card.innerHTML = `<h2>Question 1 of 2</h2>
        <p class="${ok ? 'right' : 'wrong'}">${ok ? 'Right spot!' : 'Not quite. The circle shows where you finish.'}</p>
        <button class="btn small" data-act="q2">Next question</button>`;
      start();
    };
    card.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'q2') {
        fv.clearMarks();
        const choices = [...new Set([p.action, 'block', 'route', 'carry', 'fake'])].slice(0, 4).sort();
        card.innerHTML = `<h2>Question 2 of 2</h2><p>What is your main job on this play?</p>
          <div class="answers">${choices.map((c) => `<button class="btn" data-answer="${c}">${esc(ACTIONS[c])}</button>`).join('')}</div>`;
      }
      const ans = e.target.closest('[data-answer]')?.dataset.answer;
      if (ans) {
        const ok = ans === p.action;
        score += ok ? 1 : 0;
        recordProgress(play.id, selected, score);
        card.innerHTML = `<h2>${score} of 2 right</h2>
          <p class="${ok ? 'right' : 'wrong'}">${ok ? 'Yes!' : `Your job is: ${esc(ACTIONS[p.action])}.`} ${score === 2 ? 'You know this play.' : 'Watch it again and try once more.'}</p>
          <button class="btn small" data-act="again">Try again</button>`;
      }
      if (act === 'again') startQuiz();
    };
  }

  // ---- Events ----
  app.querySelector('.viewer').addEventListener('click', (e) => {
    const pos = e.target.closest('[data-pos]')?.dataset.pos;
    if (pos) return choose(pos);
    const sp = e.target.closest('[data-speed]');
    if (sp) {
      speed = +sp.dataset.speed;
      app.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(b === sp)));
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'toggle') return playing ? pause() : start();
    if (act === 'restart') { pause(); return setT(0); }
    if (act === 'fwd') { pause(); return setT(kfs.find((k) => k > t + 0.001) ?? 1); }
    if (act === 'back') { pause(); return setT([...kfs].reverse().find((k) => k < t - 0.001) ?? 0); }
    if (act === 'watch') { $('#who').classList.add('done'); return start(); }
    if (act === 'change') { $('#who').classList.remove('done'); return $('#who').scrollIntoView({ block: 'nearest' }); }
    if (act === 'quiz') return startQuiz();
    if (act === 'zoom') { closeUp = !closeUp; return fitView(); }
  });
  $('#scrub').addEventListener('input', (e) => { pause(); setT(+e.target.value / 1000); });
  app.querySelectorAll('[data-opt]').forEach((c) => c.addEventListener('change', () => fv.setOptions({ [c.dataset.opt]: c.checked })));
  $('#frontSel').addEventListener('change', (e) => {
    front = e.target.value;
    defense = buildDefense(play, front);
    fv.setPlay(play, defense);
    fv.setOptions({ selected });
    fitView();
    setT(t);
  });
  const onKey = (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); playing ? pause() : start(); }
  };
  document.addEventListener('keydown', onKey);
  cleanup = () => { pause(); document.removeEventListener('keydown', onKey); };
}

// ---------- Start ----------
async function init() {
  try {
    if (!(await kvGet('seeded'))) {
      for (const p of SAMPLE_PLAYS) await savePlay(structuredClone(p));
      await kvSet('seeded', true);
    }
    state.plays = await getPlays();
    state.settings = { ...state.settings, ...((await kvGet('settings')) || {}) };
    state.progress = (await kvGet('progress')) || {};
  } catch {
    // Storage can be blocked (some private browsing modes). Fall back to the sample plays in memory.
    state.plays = structuredClone(SAMPLE_PLAYS);
    toast('This browser is blocking storage, so changes won’t be saved.');
  }
  document.getElementById('coachToggle').addEventListener('click', () => {
    state.settings.coach = !state.settings.coach;
    saveSettings();
    route();
  });
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
