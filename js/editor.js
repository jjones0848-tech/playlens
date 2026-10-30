// editor.js — the coach's play editor.
// Coaches check an imported play against the original sheet, drag players, draw routes,
// set who gets the ball, and write the goal and "Your job" cards.

import { FieldView } from './field.js';
import { buildDefense, frontOptions } from './sim.js';
import { FORMATIONS, ACTIONS, CATEGORIES, PLAY_TYPES, playersFromFormation, autoJob, suggestGoal } from './data.js';
import { retime, ballPlan, applyBall, applyAiResult } from './reader.js';
import { readPlayWithAI, aiAvailable } from './ai.js';
import { esc } from './util.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const half = (v) => Math.round(v * 2) / 2;

export function renderEditor(root, original, ctx) {
  const p = structuredClone(original);
  let selected = p.players.find((q) => q.id === 'QB')?.id || p.players[0]?.id;
  let mode = 'draw';
  let showDefense = false;
  let dragging = null;

  const opt = (obj, cur) => Object.entries(obj).map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const list = (arr, cur) => arr.map((v) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');

  root.innerHTML = `
  <section class="editor">
    <div class="viewer-top">
      <a href="#/" class="back">Playbook</a>
      <h1>Edit play</h1>
      <div class="top-actions">
        <button class="btn" data-act="preview">Preview</button>
        <button class="btn primary" data-act="save">Save play</button>
      </div>
    </div>
    <div class="banner" id="edBanner" hidden></div>
    <div class="editor-grid">
      <div class="editor-main">
        <div class="compare${p.sourceImage ? ' has-source' : ''}">
          ${p.sourceImage ? `<figure class="source"><img src="${p.sourceImage}" alt="Original play sheet"><figcaption>Original sheet</figcaption></figure>` : ''}
          <div class="field edit-field" id="edField"></div>
        </div>
        <div class="toolbar">
          <div class="seg" role="group" aria-label="Editing mode">
            <button data-mode="draw" aria-pressed="true">Draw route</button>
            <button data-mode="move" aria-pressed="false">Move players</button>
          </div>
          <button class="btn small" data-act="undo">Undo last point</button>
          <button class="btn small" data-act="clear">Clear route</button>
          <label class="check"><input type="checkbox" data-act="defense"> Show defense</label>
        </div>
        <p class="hint" id="hint"></p>
      </div>
      <aside class="side">
        <div class="card">
          <h2>Selected player</h2>
          <div class="field-row"><label for="selPlayer">Player</label><select id="selPlayer"></select></div>
          <div class="field-row two">
            <div><label for="pLabel">Label on field</label><input id="pLabel" maxlength="4"></div>
            <div><label for="pAction">Job type</label><select id="pAction">${opt(ACTIONS)}</select></div>
          </div>
          <p class="small-note">Leave these blank to use the text PlayLens writes for you.</p>
          <div class="field-row"><label for="jAlign">Line up</label><textarea id="jAlign" rows="2"></textarea></div>
          <div class="field-row"><label for="jStep">First step</label><textarea id="jStep" rows="2"></textarea></div>
          <div class="field-row"><label for="jJob">Your job</label><textarea id="jJob" rows="3"></textarea></div>
          <div class="field-row"><label for="jWatch">Watch for</label><textarea id="jWatch" rows="2"></textarea></div>
        </div>
        <div class="card">
          <h2>Ball</h2>
          <div class="field-row two">
            <div><label for="bType">What happens</label><select id="bType">${opt({ handoff: 'Handoff', pitch: 'Pitch', pass: 'Pass', keep: 'QB keeps it' })}</select></div>
            <div><label for="bTo">To</label><select id="bTo"></select></div>
          </div>
          <div class="field-row"><label for="bTime">When <span id="bTimeOut"></span></label><input type="range" id="bTime" min="0.05" max="0.8" step="0.01"></div>
        </div>
        <div class="card">
          <h2>Play details</h2>
          <div class="field-row"><label for="mName">Play name</label><input id="mName" maxlength="60"></div>
          <div class="field-row two">
            <div><label for="mNum">Call number</label><input id="mNum" type="number" min="0" max="999"></div>
            <div><label for="mSnap">Snap count</label><input id="mSnap" maxlength="20" placeholder="On two"></div>
          </div>
          <div class="field-row two">
            <div><label for="mCat">Category</label><select id="mCat">${list(CATEGORIES)}</select></div>
            <div><label for="mType">Play type</label><select id="mType">${opt(PLAY_TYPES)}</select></div>
          </div>
          <div class="field-row two">
            <div><label for="mFront">Default defense</label><select id="mFront">${list(frontOptions(p))}</select></div>
            <div><label for="mDur">Length (seconds)</label><input id="mDur" type="number" min="3" max="8" step="0.5"></div>
          </div>
          <div class="field-row"><label for="mForm">Formation</label>
            <div class="inline"><select id="mForm">${list(Object.keys(FORMATIONS))}</select><button class="btn small" data-act="formation">Start from this formation</button></div>
          </div>
        </div>
        <div class="card">
          <h2>Goal of the play</h2>
          <textarea id="mGoal" rows="3" placeholder="What is this play trying to do?"></textarea>
          <button class="btn small" data-act="suggest">Write one for me</button>
        </div>
        ${p.sourceImage ? `<div class="card">
          <h2>Read the sheet with AI</h2>
          <p class="small-note">PlayLens can place the players and routes from the original sheet for you. ${ctx.settings.apiKey ? '' : 'Add an API key in Settings to turn this on.'}</p>
          <button class="btn small" data-act="ai"${ctx.settings.apiKey ? '' : ' disabled'}>Read the sheet</button>
        </div>` : ''}
        <button class="btn danger" data-act="delete">Delete play</button>
      </aside>
    </div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const fv = new FieldView($('#edField'), { label: 'Play editor field' });
  const svg = fv.svg;
  svg.classList.add('editing');

  const sel = () => p.players.find((q) => q.id === selected);

  function redraw() {
    fv.setPlay(p, showDefense ? buildDefense(p, p.front) : []);
    fv.setOptions({ selected, dim: false });
    fv.render(0);
  }

  function syncPlayer() {
    $('#selPlayer').innerHTML = p.players.map((q) => `<option value="${esc(q.id)}"${q.id === selected ? ' selected' : ''}>${esc(q.label)} (${esc(ACTIONS[q.action] || q.action)})</option>`).join('');
    const q = sel();
    if (!q) return;
    $('#pLabel').value = q.label;
    $('#pAction').value = q.action;
    const auto = autoJob(p, q);
    for (const [k, id] of [['align', '#jAlign'], ['step', '#jStep'], ['job', '#jJob'], ['watch', '#jWatch']]) {
      $(id).value = q.job?.[k] || '';
      $(id).placeholder = auto[k];
    }
    $('#hint').textContent = mode === 'draw'
      ? `Tap the field to add route points for ${q.label}. Tap another player to switch.`
      : 'Drag a player to move where he lines up. His route moves with him.';
  }

  function syncBall() {
    const plan = ballPlan(p);
    $('#bType').value = plan.type;
    $('#bTo').innerHTML = p.players.filter((q) => q.id !== 'QB').map((q) => `<option value="${esc(q.id)}"${q.id === plan.to ? ' selected' : ''}>${esc(q.label)}</option>`).join('');
    $('#bTime').value = plan.time;
    $('#bTimeOut').textContent = `(${Math.round(plan.time * (p.duration || 4) * 10) / 10}s after the snap)`;
    $('#bTo').disabled = $('#bTime').disabled = plan.type === 'keep';
  }

  function setBanner(kind, text, retry) {
    const b = $('#edBanner');
    if (!kind) { b.hidden = true; return; }
    b.hidden = false;
    b.className = `banner banner-${kind}`;
    b.innerHTML = `<span>${esc(text)}</span>${retry ? '<button class="btn small" data-act="ai">Try again</button>' : ''}`;
  }

  function bannerForState() {
    if (p.status !== 'draft') return setBanner(null);
    if (p.aiRead) return setBanner('ok', 'PlayLens read this sheet and placed every player, route and defender. Press Preview to watch it, fix anything that’s off, then save.');
    if (p.readError) return setBanner('error', `PlayLens couldn’t read this sheet: ${p.readError}`, !!p.sourceImage);
    if (p.sourceImage) return setBanner('info', 'Add an API key in Settings and PlayLens will place every player for you. Until then, place the players and draw the routes here.');
    return setBanner('info', 'Place the players and draw the routes, then save.');
  }

  let reading = false;
  async function readSheet() {
    if (reading || !p.sourceImage) return;
    reading = true;
    setBanner('working', 'Reading the sheet: finding every player, route and defender. This can take up to a minute…');
    root.querySelectorAll('[data-act="ai"]').forEach((b) => { b.disabled = true; });
    try {
      applyAiResult(p, await readPlayWithAI(p.sourceImage, ctx.settings));
      delete p.readError;
      selected = p.players.find((q) => q.action === 'carry')?.id || p.players[0].id;
      syncAll();
    } catch (err) {
      p.readError = err.message || 'The sheet couldn’t be read.';
    } finally {
      reading = false;
      p.readTried = true;
      await ctx.save(p);
      bannerForState();
      root.querySelectorAll('[data-act="ai"]').forEach((b) => { b.disabled = false; });
    }
  }

  function syncMeta() {
    $('#mFront').innerHTML = list(frontOptions(p));
    $('#mName').value = p.name || '';
    $('#mNum').value = p.number ?? '';
    $('#mSnap').value = p.snap || '';
    $('#mCat').value = p.category || 'Runs';
    $('#mType').value = p.type || 'run';
    $('#mFront').value = p.front || '4-4';
    $('#mDur').value = p.duration || 4;
    $('#mForm').value = p.formation || 'I-form';
    $('#mGoal').value = p.goal || '';
  }

  function syncAll() { syncPlayer(); syncBall(); syncMeta(); redraw(); }

  function readBall() {
    applyBall(p, { type: $('#bType').value, to: $('#bTo').value, time: +$('#bTime').value });
    syncBall();
    redraw();
  }

  // ---- Field interaction ----
  function nearest(x, y, max = 1.8) {
    let best = null;
    let bestD = max;
    for (const q of p.players) {
      const d = Math.hypot(q.start[0] - x, q.start[1] - y);
      if (d < bestD) { best = q; bestD = d; }
    }
    return best;
  }

  svg.addEventListener('pointerdown', (e) => {
    const [x, y] = fv.eventToField(e);
    const hit = nearest(x, y);
    if (mode === 'move') {
      if (!hit) return;
      selected = hit.id;
      dragging = { id: hit.id, ox: x - hit.start[0], oy: y - hit.start[1] };
      svg.setPointerCapture(e.pointerId);
      syncPlayer();
      redraw();
      return;
    }
    const q = sel();
    if (hit && hit.id !== selected) { selected = hit.id; syncPlayer(); redraw(); return; }
    if (!q) return;
    q.path.push([half(clamp(x, -26.5, 26.5)), half(clamp(y, -14.5, 24.5)), 1]);
    retime(q, p.duration || 4);
    syncPlayer();
    redraw();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const q = p.players.find((r) => r.id === dragging.id);
    const [x, y] = fv.eventToField(e);
    const nx = half(clamp(x - dragging.ox, -26.5, 26.5));
    const ny = half(clamp(y - dragging.oy, -14.5, -0.5));
    const dx = nx - q.start[0];
    const dy = ny - q.start[1];
    if (!dx && !dy) return;
    q.start = [nx, ny];
    q.path = q.path.map(([px, py, t]) => [px + dx, py + dy, t]);
    redraw();
  });
  const endDrag = () => { if (dragging) { dragging = null; syncPlayer(); } };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // ---- Form inputs ----
  $('#selPlayer').addEventListener('change', (e) => { selected = e.target.value; syncPlayer(); redraw(); });
  $('#pLabel').addEventListener('input', (e) => { sel().label = e.target.value.toUpperCase() || sel().id; redraw(); });
  $('#pAction').addEventListener('change', (e) => { const q = sel(); q.action = e.target.value; retime(q, p.duration || 4); syncPlayer(); redraw(); });
  for (const [k, id] of [['align', '#jAlign'], ['step', '#jStep'], ['job', '#jJob'], ['watch', '#jWatch']]) {
    $(id).addEventListener('input', (e) => { const q = sel(); q.job = { ...q.job, [k]: e.target.value.trim() }; });
  }
  $('#bType').addEventListener('change', readBall);
  $('#bTo').addEventListener('change', readBall);
  $('#bTime').addEventListener('input', readBall);
  $('#mName').addEventListener('input', (e) => { p.name = e.target.value; });
  $('#mNum').addEventListener('input', (e) => { p.number = e.target.value === '' ? null : +e.target.value; });
  $('#mSnap').addEventListener('input', (e) => { p.snap = e.target.value; });
  $('#mCat').addEventListener('change', (e) => { p.category = e.target.value; });
  $('#mType').addEventListener('change', (e) => { p.type = e.target.value; });
  $('#mFront').addEventListener('change', (e) => { p.front = e.target.value; redraw(); });
  $('#mDur').addEventListener('change', (e) => { p.duration = clamp(+e.target.value || 4, 3, 8); syncBall(); redraw(); });
  $('#mGoal').addEventListener('input', (e) => { p.goal = e.target.value; });

  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    root.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    syncPlayer();
  }));

  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const q = sel();
    if (act === 'undo' && q) { q.path.pop(); retime(q, p.duration || 4); syncPlayer(); redraw(); }
    if (act === 'clear' && q) { q.path = []; syncPlayer(); redraw(); }
    if (act === 'defense') { showDefense = e.target.checked; redraw(); }
    if (act === 'suggest') { p.goal = suggestGoal(p); $('#mGoal').value = p.goal; }
    if (act === 'formation') {
      const hasRoutes = p.players.some((r) => r.path.length);
      if (hasRoutes && !confirm('Starting from a formation removes the routes you drew. Continue?')) return;
      p.formation = $('#mForm').value;
      p.players = playersFromFormation(p.formation);
      p.ball = [{ t: 0, hold: 'QB' }];
      selected = 'QB';
      syncAll();
    }
    if (act === 'save' || act === 'preview') {
      if (!p.name?.trim()) { ctx.toast('Give the play a name before saving.'); $('#mName').focus(); return; }
      p.status = 'ready';
      await ctx.save(p);
      if (act === 'preview') location.hash = `#/play/${p.id}`;
      else ctx.toast('Play saved');
    }
    if (act === 'delete') {
      if (!confirm(`Delete “${p.name}”? This can’t be undone.`)) return;
      await ctx.remove(p.id);
      location.hash = '#/';
    }
    if (act === 'ai') readSheet();
  });

  syncAll();
  bannerForState();
  // A sheet that hasn't been read yet (or was uploaded before automatic reading) gets read now.
  if (p.status === 'draft' && p.sourceImage && !p.aiRead && !p.readTried) {
    aiAvailable(ctx.settings).then((ok) => { if (ok) readSheet(); else bannerForState(); });
  }
  return () => {};
}
