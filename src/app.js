// DupeCleaner — interfaz. La lógica pura vive en los módulos importados.
import { createHasher } from './hasher.js';
import { isSampled, needsPrefix } from './sha256.js';
import { DupeIndex } from './dupe-index.js';
import { planRemoval, verifyBeforeRemoval, REFUSE } from './safety.js';
import { moveToQuarantine, removeFile } from './quarantine.js';
import { DEFAULT_CFG, SKIP, detectSystemRoot, dirSkipReason, isIgnoredFile } from './filters.js';
import { esc, fmtSize, extOf, getIcon, isImg, isTxt, isVideo, isAudio, isPdf } from './format.js';
import { VirtualScroller } from './virtual-scroller.js';

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
const $        = id => document.getElementById(id);
const t        = (es, en) => document.body.classList.contains('es') ? es : en;
const frame    = () => new Promise(r => requestAnimationFrame(r));
const hasFSAPI = () => 'showDirectoryPicker' in window;
const MAX_FEED = 300;

/* Ajustes de rendimiento. `?perf=legacy` reproduce el comportamiento anterior
   (SHA-256 en JS, un worker, sin prefiltro, un fotograma por carpeta, cada 15
   archivos y por duplicado); solo sirve para la prueba de rendimiento. */
const PERF = new URLSearchParams(location.search).get('perf') === 'legacy'
  ? { legacy: true,  engine: 'js',   workers: 1,         prefilter: false }
  : { legacy: false, engine: 'wasm', workers: undefined, prefilter: true, yieldMs: 12 };

const hasher = createHasher({ engine: PERF.engine, ...(PERF.workers ? { size: PERF.workers } : {}) });

/* Cede el control al navegador como mucho cada PERF.yieldMs, no en cada
   elemento, y sin esperar a un fotograma entero: una tarea nueva basta para
   que el navegador pinte y atienda clics. Además sigue avanzando en una
   pestaña oculta, donde requestAnimationFrame se congela. */
const yieldTask = globalThis.scheduler?.yield
  ? () => globalThis.scheduler.yield()
  : () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

let lastYield = 0;
let legacyCount = 0;
async function breathe(kind) {
  if (PERF.legacy) {
    if (kind === 'hash' || (kind === 'file' && ++legacyCount % 15)) return;
    await frame();
    return;
  }
  if (performance.now() - lastYield < PERF.yieldMs) return;
  await yieldTask();
  lastYield = performance.now();
}

/* ═══════════════════════════════════════════════════════════
   STATE
   Cada escaneo es un objeto propio con su índice y su selección.
   Cancelar o reiniciar solo marca ese objeto; un bucle antiguo que
   siga vivo comprueba `alive(s)` tras cada await y deja de escribir.
═══════════════════════════════════════════════════════════ */
const cfg    = { ...DEFAULT_CFG };
let pending  = null;  // carpeta elegida, pendiente de confirmar
let scan     = null;  // escaneo actual
let scanSeq  = 0;
let removing = false;

const newScan = p => ({
  id: ++scanSeq, cancelled: false, done: false,
  root: p.root, name: p.name, limited: p.limited, inputFiles: p.inputFiles,
  cfg: { ...cfg }, index: new DupeIndex(), sel: new Set(),
  abort: new AbortController(),
  fileCount: 0, skipCount: 0, errors: 0,
});
const alive = s => s === scan && !s.cancelled;

/* ═══════════════════════════════════════════════════════════
   VIRTUAL SCROLLER
═══════════════════════════════════════════════════════════ */
const groupByKey = key => scan?.index.groups.get(key);

const vs = new VirtualScroller($('dupes-scroll'), $('vs-spacer'), {
  estimate: key => { const g = groupByKey(key); return g ? 52 + g.files.length * 47 + 16 : 80; },
  extOf:    key => { const g = groupByKey(key); return g ? extOf(g.files[0].name) : ''; },
  render:   (el, key) => renderGroupCard(el, key),
});

/* Todo lo que viene del disco (nombres, rutas) pasa por esc(); los
   atributos de acción solo llevan ids numéricos. */
function renderGroupCard(el, key) {
  const s = scan;
  const g = groupByKey(key);
  if (!s || !g || g.files.length < 2) { el.innerHTML = ''; return; }

  const ext  = extOf(g.files[0].name);
  const prob = g.sampled
    ? `<span class="probable-tag" title="${esc(t(
        'Comparado solo por muestras (inicio, centro y final). Se comprobará el archivo completo antes de quitarlo.',
        'Compared by samples only (start, middle and end). The full file is checked before removing it.'))}">${esc(t('probable', 'probable'))}</span>`
    : '';

  let html = `<div class="dg" data-ext="${esc(ext)}">
    <div class="dg-hdr">
      <span>
        <span class="h">${esc(g.hash.substring(0, 14))}&hellip;</span>${prob}
        &nbsp;&middot;&nbsp;${g.files.length} ${esc(g.sampled ? t('copias probables', 'probable copies') : t('copias idénticas', 'identical copies'))}
        &nbsp;&middot;&nbsp;${fmtSize(g.size)} ${esc(t('c/u', 'each'))}
        ${ext ? `&nbsp;&middot;&nbsp;<span style="color:var(--muted)">.${esc(ext)}</span>` : ''}
      </span>
      <span class="sv" title="${esc(t('espacio recuperable', 'space freed by removing copies'))}">
        &larr; ${fmtSize(g.size * (g.files.length - 1))}
      </span>
    </div>`;

  g.files.forEach((r, i) => {
    const isOrig    = i === 0;
    const canDelete = !s.limited && r.canDelete !== false;
    const selected  = s.sel.has(r.id);
    const disabled  = (isOrig || !canDelete)
      ? `disabled title="${esc(isOrig ? t('Original: no se puede quitar', 'Original: cannot be removed') : t('Solo lectura en este navegador', 'Read-only in this browser'))}"`
      : '';

    html += `<div class="df${isOrig ? ' orig' : ''}${selected ? ' sel' : ''}" data-row="${r.id}">
      <input type="checkbox" data-action="toggle-sel" data-id="${r.id}" ${disabled} ${selected ? 'checked' : ''} aria-label="${esc(r.name)}">
      <i class="${getIcon(r.name)} df-icon"></i>
      <div class="df-info">
        <div class="df-name">${esc(r.name)}${isOrig ? `<span class="orig-tag">${esc(t('original', 'original'))}</span>` : ''}</div>
        <div class="df-path">${esc(r.dir)}</div>
      </div>
      <button class="btn-eye" data-action="preview" data-id="${r.id}" title="${esc(t('Vista previa', 'Preview'))}">
        <i class="fas fa-eye"></i>
      </button>
    </div>`;
  });

  el.innerHTML = html + '</div>';
}

/* ═══════════════════════════════════════════════════════════
   BOOTSTRAP — theme, compat banner
═══════════════════════════════════════════════════════════ */
try {
  if (localStorage.getItem('dc-theme') === 'dark') {
    document.body.classList.add('dark');
    $('theme-icon').className = 'fas fa-sun';
  }
} catch { /* sin localStorage: tema por defecto */ }

function updateCompatNote() {
  $('compat-note').textContent = hasFSAPI()
    ? t('Chrome · Edge · Android Chrome — escaneo y eliminación completos',
        'Chrome · Edge · Android Chrome — full scan and deletion')
    : t('Firefox / Safari — solo escaneo (sin eliminación)',
        'Firefox / Safari — scan only (deletion not supported)');
}
updateCompatNote();
if (!hasFSAPI()) $('limited-warn').style.display = 'block';

function showScreen(name) {
  $('home').style.display         = name === 'home'    ? '' : 'none';
  $('confirm-step').style.display = name === 'confirm' ? 'flex' : 'none';
  $('ok-screen').style.display    = name === 'ok'      ? 'flex' : 'none';
  $('vs-spacer').style.display    = name === 'vs'      ? '' : 'none';
}

/* ═══════════════════════════════════════════════════════════
   EVENT WIRING  (sin manejadores inline)
═══════════════════════════════════════════════════════════ */
const ACTIONS = {
  'toggle-feed':    toggleMobileFeed,
  'toggle-lang':    toggleLang,
  'toggle-theme':   toggleTheme,
  'open-settings':  openSettings,
  'close-settings': closeSettings,
  'save-settings':  saveSettings,
  'precision':      el => selectPrecision(el.dataset.value),
  'stop-scan':      stopScan,
  'reset':          resetApp,
  'filter':         el => setFilter(el.dataset.ext, el),
  'pick-folder':    pickFolder,
  'cancel-pick':    cancelPick,
  'begin-scan':     beginScan,
  'select-all':     selectAll,
  'deselect-all':   deselectAll,
  'open-modal':     openModal,
  'close-modal':    closeModal,
  'exec-removal':   execRemoval,
  'preview':        el => previewFile(Number(el.dataset.id)),
  'close-preview':  closePreview,
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el, e);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.action === 'toggle-sel') toggleSel(Number(el.dataset.id), el.checked, el);
  if (el.dataset.action === 'del-mode')   setDelMode(el.value);
});

$('modal-input').addEventListener('input', updateConfirmState);
$('settings-ov').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });
$('modal-ov').addEventListener('click',    e => { if (e.target === e.currentTarget) closeModal(); });

$('mobile-input').addEventListener('change', function () {
  const files = Array.from(this.files);
  if (!files.length) return;
  const name = files[0].webkitRelativePath.split('/')[0];
  pending = { root: null, name, limited: true, inputFiles: files };
  showConfirm(name);
});

/* ═══════════════════════════════════════════════════════════
   UI CONTROLS
═══════════════════════════════════════════════════════════ */
function toggleTheme() {
  const dark = document.body.classList.toggle('dark');
  $('theme-icon').className = dark ? 'fas fa-sun' : 'fas fa-moon';
  try { localStorage.setItem('dc-theme', dark ? 'dark' : 'light'); } catch { /* no persistente */ }
}

function toggleLang() {
  const isEs = document.body.classList.contains('es');
  document.body.classList.toggle('es', !isEs);
  document.body.classList.toggle('en',  isEs);
  document.documentElement.lang = isEs ? 'en' : 'es';
  $('modal-input').placeholder = isEs ? 'CONFIRM' : 'CONFIRMAR';
  updateCompatNote();
  updateSelectionUI();
  updateConfirmState();
  updateStats();
  vs.refreshAll(); // las tarjetas llevan textos traducidos
}

function toggleMobileFeed() {
  const panel = $('panel-left');
  panel.classList.toggle('mobile-open');
  $('mobile-feed-btn').classList.toggle('feed-visible', panel.classList.contains('mobile-open'));
}

function setDot(state, label) {
  $('scan-dot').className   = 'dot d-' + state;
  $('scan-lbl').textContent = label;
}

function cancelScan(s) {
  if (!s) return;
  s.cancelled = true;
  s.abort.abort(); // corta también un hash que esté a medias
}

function stopScan() { cancelScan(scan); }

/* ═══════════════════════════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════════════════════════ */
function selectPrecision(val) {
  $('card-sample').classList.toggle('selected', val === 'sample');
  $('card-full').classList.toggle('selected',   val === 'full');
  $('radio-sample').checked = val === 'sample';
  $('radio-full').checked   = val === 'full';
}

function openSettings() {
  $('cfg-dev').checked      = cfg.ignoreDev;
  $('cfg-hidden').checked   = cfg.ignoreHidden;
  $('cfg-sysfiles').checked = cfg.ignoreSysFiles;

  let displaySize = cfg.minFileSize;
  let unitVal     = '1024';
  if      (cfg.minFileSize >= 1048576) { displaySize = cfg.minFileSize / 1048576; unitVal = '1048576'; }
  else if (cfg.minFileSize >= 1024)    { displaySize = cfg.minFileSize / 1024;    unitVal = '1024'; }
  else if (cfg.minFileSize > 0)        { unitVal = '1'; }
  $('cfg-minsize').value = displaySize || 0;
  $('cfg-minunit').value = unitVal;

  selectPrecision(cfg.strategy);
  $('settings-ov').classList.add('on');
}

function closeSettings() { $('settings-ov').classList.remove('on'); }

function saveSettings() {
  cfg.ignoreDev      = $('cfg-dev').checked;
  cfg.ignoreHidden   = $('cfg-hidden').checked;
  cfg.ignoreSysFiles = $('cfg-sysfiles').checked;

  const sizeVal  = parseFloat($('cfg-minsize').value) || 0;
  const unitMult = parseInt($('cfg-minunit').value, 10) || 1;
  cfg.minFileSize = Math.max(0, Math.round(sizeVal * unitMult));
  cfg.strategy    = document.querySelector('input[name="cfg-strategy"]:checked')?.value || 'sample';

  closeSettings();
}

/* ═══════════════════════════════════════════════════════════
   FORMAT FILTER
═══════════════════════════════════════════════════════════ */
const activeFilters = new Set();
const detectedExts  = new Set();

function addExtToFilter(ext) {
  if (detectedExts.has(ext)) return;
  detectedExts.add(ext);
  const bar  = $('filter-bar');
  bar.classList.add('visible');
  const chip = document.createElement('button');
  chip.className      = 'fmt-chip';
  chip.dataset.ext    = ext;
  chip.dataset.action = 'filter';
  chip.textContent    = ext ? '.' + ext : t('sin extensión', 'no extension');
  bar.appendChild(chip);
}

function setFilter(ext, el) {
  if (ext === 'all') {
    activeFilters.clear();
    document.querySelectorAll('.fmt-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
  } else {
    activeFilters.has(ext) ? activeFilters.delete(ext) : activeFilters.add(ext);
    el.classList.toggle('active', activeFilters.has(ext));
    document.querySelector('.fmt-chip.all')?.classList.toggle('active', activeFilters.size === 0);
  }
  vs.setFilter(activeFilters);
}

function resetFilterBar() {
  activeFilters.clear(); detectedExts.clear();
  const fb = $('filter-bar');
  fb.classList.remove('visible');
  fb.querySelectorAll('.fmt-chip:not(.all)').forEach(c => c.remove());
  fb.querySelector('.fmt-chip.all')?.classList.add('active');
}

/* ═══════════════════════════════════════════════════════════
   RESIZABLE PANELS
═══════════════════════════════════════════════════════════ */
function makeDivider(divId, leftId, rightId) {
  const div = $(divId);
  const L   = $(leftId);
  const R   = $(rightId);
  div.addEventListener('mousedown', e => {
    e.preventDefault();
    const x0  = e.clientX;
    const w0L = L.getBoundingClientRect().width;
    const w0R = R.getBoundingClientRect().width;
    div.classList.add('drag');
    const mv = ev => {
      L.style.cssText += `;flex:none;width:${Math.max(100, w0L + ev.clientX - x0)}px`;
      R.style.cssText += `;flex:none;width:${Math.max(100, w0R - (ev.clientX - x0))}px`;
    };
    const up = () => {
      div.classList.remove('drag');
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup',   up);
    };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup',   up);
  });
}
makeDivider('div-1', 'panel-left', 'panel-mid');
makeDivider('div-2', 'panel-mid',  'panel-right');

/* ═══════════════════════════════════════════════════════════
   FEED LOG
═══════════════════════════════════════════════════════════ */
const $feed = $('feed');
const FEED_PLACEHOLDER = $feed.innerHTML;

/* Las líneas se acumulan y se pintan una vez por fotograma */
let feedQueue = [];
let feedRaf   = 0;

function feedLine(text, cls) {
  feedQueue.push([text, cls]);
  if (feedQueue.length > MAX_FEED) feedQueue.splice(0, feedQueue.length - MAX_FEED);
  if (!feedRaf) feedRaf = requestAnimationFrame(flushFeed);
}

function flushFeed() {
  feedRaf = 0;
  if (!feedQueue.length) return;
  $('feed-ph')?.remove();
  const frag = document.createDocumentFragment();
  for (const [text, cls] of feedQueue) {
    const el = document.createElement('div');
    el.className   = 'fl fl-' + cls;
    el.textContent = text;
    frag.appendChild(el);
  }
  feedQueue = [];
  $feed.appendChild(frag);
  let extra = $feed.childElementCount - MAX_FEED;
  while (extra-- > 0) $feed.firstElementChild.remove();
  $feed.scrollTop = $feed.scrollHeight;
}

function clearFeed(html = '') {
  feedQueue = [];
  if (feedRaf) { cancelAnimationFrame(feedRaf); feedRaf = 0; }
  $feed.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════
   FOLDER PICKING
═══════════════════════════════════════════════════════════ */
async function pickFolder() {
  if (!hasFSAPI()) { $('mobile-input').click(); return; }
  let root;
  try { root = await window.showDirectoryPicker({ mode: 'readwrite' }); }
  catch { return; }
  if (typeof root.requestPermission === 'function') {
    let p;
    try { p = await root.requestPermission({ mode: 'readwrite' }); }
    catch (e) { p = 'error: ' + errMsg(e); }
    if (p !== 'granted') {
      alert(t('Se necesita permiso de lectura y escritura sobre la carpeta. Acepta el permiso del navegador.',
              'Read and write permission on the folder is required. Accept the browser permission prompt.'));
      return;
    }
  }
  pending = { root, name: root.name, limited: false };
  showConfirm(root.name);
}

function showConfirm(name) {
  $('confirm-path-text').textContent = name;
  showScreen('confirm');
}

function cancelPick() {
  pending = null;
  showScreen('home');
  $('mobile-input').value = '';
}

/* ═══════════════════════════════════════════════════════════
   SCAN ORCHESTRATION
═══════════════════════════════════════════════════════════ */
async function beginScan() {
  if (!pending) return;
  cancelScan(scan);
  const s = scan = newScan(pending);
  try {
    await runScan(s);
  } catch (e) {
    // Error inesperado: nunca dejar la interfaz en "ejecutando"
    console.error('[DupeCleaner]', e);
    if (s !== scan) return;
    s.errors++;
    feedLine('✗  ' + t('Error inesperado', 'Unexpected error') + ': ' + errMsg(e), 'err');
    finishStopped(s, t('error', 'error'));
  }
}

async function runScan(s) {

  vs.reset();
  showScreen('vs');
  resetFilterBar();
  clearFeed();
  closePreview();

  $('nav-folder').style.display    = 'flex';
  $('nav-folder-name').textContent = s.name;
  $('btn-stop').style.display      = 'flex';
  $('btn-reset').style.display     = 'none';
  $('pbar').style.width            = '0%';
  updateStats(); updateSelectionUI();

  setDot('run', t('recopilando archivos…', 'collecting files…'));
  await breathe();
  if (!alive(s)) return finishStopped(s);
  feedLine('📂  ' + s.name, 'dir');

  if (s.limited) await collectFromInput(s, s.inputFiles);
  else           await collectRoot(s);
  if (!alive(s)) return finishStopped(s);

  setDot('run', t('calculando SHA-256…', 'computing SHA-256…'));
  await breathe();
  await findDupes(s);
  if (!alive(s)) return finishStopped(s);

  s.done = true;
  setDot('idle', t('completado', 'done'));
  $('pbar').style.width        = '100%';
  $('btn-stop').style.display  = 'none';
  $('btn-reset').style.display = 'flex';

  const gs = s.index.dupGroups();
  feedLine('─────────────────────────────', 'info');
  feedLine(
    '✓  ' + s.fileCount + ' ' + t('archivos escaneados', 'files scanned') + ' · ' +
    gs.length + ' ' + t('conjuntos de duplicados', 'duplicate sets') +
    (s.skipCount ? ' · ' + s.skipCount + ' ' + t('carpetas omitidas', 'folders skipped') : ''),
    'ok'
  );
  if (s.errors)
    feedLine('⚠  ' + s.errors + ' ' + t('errores de lectura (ver líneas en rojo)', 'read errors (see red lines)'), 'err');
  if (gs.some(g => g.sampled))
    feedLine(t('⚠ Algunos conjuntos son probables (comparados por muestras). Se verifican completos antes de quitarlos.',
               '⚠ Some sets are probable (sample-compared). They are fully verified before removal.'), 'info');

  updateStats(); updateSelectionUI();
  if (gs.length === 0) showOkScreen(s);
}

/* Un escaneo que ya no es el actual termina en silencio: la interfaz es de otro */
function finishStopped(s, label) {
  if (s !== scan) return;
  s.done = true;
  setDot('stop', label || t('detenido', 'stopped'));
  $('btn-stop').style.display  = 'none';
  $('btn-reset').style.display = 'flex';
  if (!label) feedLine(t('— Escaneo detenido por el usuario —', '— Scan stopped by user —'), 'info');
  updateStats(); updateSelectionUI();
}

const errMsg = e => e?.message || e?.name || String(e);

const SKIP_LABEL = {
  [SKIP.SYSTEM]:     ['sistema', 'system'],
  [SKIP.QUARANTINE]: ['cuarentena', 'quarantine'],
  [SKIP.DEV]:        ['desarrollo', 'development'],
  [SKIP.HIDDEN]:     ['oculta', 'hidden'],
};
const skipLabel = r => t(...SKIP_LABEL[r]);

function showOkScreen(s) {
  const okEl = $('ok-screen');
  okEl.innerHTML = `
    <div class="home-icon" style="font-size:2.5rem;opacity:.3;"><i class="fas fa-circle-check"></i></div>
    <h2 class="es">¡Sin duplicados!</h2><h2 class="en">No duplicates!</h2>
    <p class="es">No quedan archivos idénticos en <strong>${esc(s.name)}</strong>.</p>
    <p class="en">No identical files left in <strong>${esc(s.name)}</strong>.</p>
    <button class="btn-primary" data-action="reset">
      <i class="fas fa-rotate-left"></i>
      <span class="es">Nuevo escaneo</span><span class="en">New scan</span>
    </button>`;
  showScreen('ok');
}

let statsRaf = 0;
/* Actualiza contadores como mucho una vez por fotograma */
function updateStatsSoon() {
  if (!statsRaf) statsRaf = requestAnimationFrame(() => { statsRaf = 0; updateStats(); });
}

/* ═══════════════════════════════════════════════════════════
   COLLECT — File System Access API
═══════════════════════════════════════════════════════════ */
async function collectRoot(s) {
  // Primero el nivel superior, para saber si es la raíz de un sistema operativo
  const top = [];
  try {
    for await (const entry of s.root.entries()) {
      if (!alive(s)) return;
      top.push(entry);
    }
  } catch (e) {
    s.errors++;
    feedLine('✗  ' + s.name + ' — ' + t('no se puede leer la carpeta', 'cannot read folder') + ': ' + errMsg(e), 'err');
    return;
  }
  s.systemRoot = detectSystemRoot(top.filter(([, h]) => h.kind === 'directory').map(([n]) => n));
  if (s.systemRoot)
    feedLine(t('ℹ Parece la raíz de un sistema (' + s.systemRoot + '): se omiten sus carpetas del sistema',
               'ℹ Looks like a system root (' + s.systemRoot + '): its OS folders are skipped'), 'info');
  await collectEntries(s, s.root, top, s.name, [], 1);
}

async function collectDir(s, dh, path, relDir, depth) {
  try {
    const entries = [];
    for await (const entry of dh.entries()) {
      if (!alive(s)) return;
      entries.push(entry);
    }
    await collectEntries(s, dh, entries, path, relDir, depth);
  } catch (e) {
    if (!alive(s)) return;
    s.errors++;
    feedLine('✗  ' + path + ' — ' + t('no se puede leer la carpeta', 'cannot read folder') + ': ' + errMsg(e), 'err');
  }
}

async function collectEntries(s, dh, entries, path, relDir, depth) {
  for (const [name, handle] of entries) {
    if (!alive(s)) return;
    const fullPath = path + '/' + name;
    if (handle.kind === 'directory') {
      const reason = dirSkipReason(name, depth, s.systemRoot, s.cfg);
      if (reason) {
        feedLine('✗  ' + fullPath + '  [' + t('omitida', 'skipped') + ': ' + skipLabel(reason) + ']', 'skip');
        s.skipCount++; continue;
      }
      feedLine('▸  ' + fullPath, 'dir'); await breathe();
      await collectDir(s, handle, fullPath, [...relDir, name], depth + 1);
    } else {
      try {
        const file = await handle.getFile();
        if (!alive(s)) return;
        if (file.size < s.cfg.minFileSize) continue;
        if (isIgnoredFile(name, s.cfg))     continue;
        feedLine('   ' + name, 'file');
        s.index.addFile({
          path: fullPath, name, dir: path, relDir, size: file.size, lastModified: file.lastModified,
          handle, parent: dh, canDelete: true,
        });
        s.fileCount++;
        updateStatsSoon();
        await breathe('file');
      } catch (e) {
        if (!alive(s)) return;
        s.errors++;
        feedLine('✗  ' + fullPath + ' — ' + errMsg(e), 'err');
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   COLLECT — <input webkitdirectory> fallback
═══════════════════════════════════════════════════════════ */
async function collectFromInput(s, files) {
  // Carpetas del primer nivel, para detectar una raíz de sistema
  const topDirs = new Set();
  for (const f of files) {
    const parts = f.webkitRelativePath.split('/');
    if (parts.length > 2) topDirs.add(parts[1]);
  }
  s.systemRoot = detectSystemRoot(topDirs);

  const seenDirs    = new Set();
  const skippedDirs = new Set();
  for (let i = 0; i < files.length; i++) {
    if (!alive(s)) return;
    const file  = files[i];
    const rel   = file.webkitRelativePath;
    const parts = rel.split('/');
    const name  = parts[parts.length - 1];
    const dir   = parts.slice(0, -1).join('/');
    const sub   = parts.slice(1, -1); // carpetas bajo la raíz (el archivo no cuenta)

    // Las reglas de carpetas se aplican solo a carpetas, nunca al nombre del archivo
    const skipAt = sub.findIndex((p, d) => dirSkipReason(p, d + 1, s.systemRoot, s.cfg));
    if (skipAt >= 0) {
      const skipped = parts.slice(0, skipAt + 2).join('/');
      if (!skippedDirs.has(skipped)) {
        skippedDirs.add(skipped);
        s.skipCount++;
        const reason = dirSkipReason(sub[skipAt], skipAt + 1, s.systemRoot, s.cfg);
        feedLine('✗  ' + skipped + '  [' + t('omitida', 'skipped') + ': ' + skipLabel(reason) + ']', 'skip');
      }
      continue;
    }
    if (file.size < s.cfg.minFileSize) continue;
    if (isIgnoredFile(name, s.cfg))     continue;

    if (!seenDirs.has(dir)) { seenDirs.add(dir); feedLine('▸  ' + dir, 'dir'); }
    feedLine('   ' + name, 'file');
    s.index.addFile({
      path: rel, name, dir, relDir: sub, size: file.size, lastModified: file.lastModified,
      fileObj: file, handle: null, parent: null, canDelete: false,
    });
    s.fileCount++;
    updateStatsSoon();
    await breathe('file');
  }
}

/* ═══════════════════════════════════════════════════════════
   FIND DUPLICATES
═══════════════════════════════════════════════════════════ */
async function findDupes(s) {
  const candidates = s.index.sizeCandidates();
  const total      = candidates.reduce((n, g) => n + g.length, 0);
  if (total === 0) return;

  feedLine('─────────────────────────────', 'info');
  feedLine('SHA-256: ' + total + ' ' + t('candidatos por tamaño', 'size-matched candidates') +
           ' · ' + hasher.size + ' ' + t('workers', 'workers'), 'info');
  if (s.cfg.strategy === 'sample')
    feedLine(t('⚡ Modo muestras activo para archivos > 20 MB', '⚡ Sampling mode active for files > 20 MB'), 'info');
  await breathe();

  const $pb = $('pbar');
  const progress = (from, to, done, n) => { $pb.style.width = Math.round(from + (to - from) * done / Math.max(1, n)) + '%'; };

  // Fase 1 — prefiltro: hash de los primeros 64 KB de los archivos grandes.
  // Los que no coinciden con nadie ya no se leen enteros.
  let finalSets = candidates;
  if (PERF.prefilter) {
    const small = candidates.filter(g => !needsPrefix(g[0].size));
    const big   = candidates.filter(g =>  needsPrefix(g[0].size)).flat();
    if (big.length) {
      const byPrefix = new Map();
      let done = 0;
      await runPool(s, big, async r => {
        const h = await hashRec(s, r, 'prefix');
        if (h) {
          const key = r.size + ':' + h;
          if (!byPrefix.has(key)) byPrefix.set(key, []);
          byPrefix.get(key).push(r);
        }
        progress(0, 30, ++done, big.length);
      });
      if (!alive(s)) return;
      const kept = [...byPrefix.values()].filter(g => g.length > 1);
      const keptN = kept.reduce((n, g) => n + g.length, 0);
      feedLine(t('Prefiltro (64 KB): ', 'Prefilter (64 KB): ') + (big.length - keptN) + ' / ' + big.length +
               ' ' + t('descartados sin leerlos enteros', 'discarded without reading them fully'), 'info');
      finalSets = small.concat(kept);
    }
  }

  // Fase 2 — hash final (completo, o por muestras en modo rápido)
  const items = finalSets.flat();
  let done = 0;
  await runPool(s, items, async r => {
    const hash = await hashRec(s, r, s.cfg.strategy);
    let kind = 'hash';
    if (hash && alive(s)) {
      const g = s.index.addHash(r, hash, isSampled(r.size, s.cfg.strategy));
      if (g.files.length >= 2) {
        feedLine('💥 ' + (g.sampled ? t('PROBABLE DUPLICADO', 'PROBABLE DUPLICATE') : t('DUPLICADO', 'DUPLICATE')) + ': ' + r.name, 'match');
        if (g.files.length === 2) addGroupToList(g);
        else                      vs.update(g.key);
        kind = 'dupe';
      }
    }
    progress(PERF.prefilter ? 30 : 0, 100, ++done, items.length);
    updateStatsSoon();
    await breathe(kind);
  });
}

/* Ejecuta fn sobre items con tantas tareas a la vez como workers tenga el pool */
async function runPool(s, items, fn) {
  let next = 0;
  const lane = async () => {
    while (next < items.length && alive(s)) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(hasher.size, items.length) }, lane));
}

/* Hash de un archivo del índice; los errores se registran y devuelven null */
async function hashRec(s, r, strategy) {
  if (!alive(s)) return null;
  if (strategy !== 'prefix') feedLine('  ⚡ ' + r.name, 'file');
  try {
    const file = r.fileObj || await r.handle.getFile();
    if (!alive(s)) return null;
    if (!r.fileObj && (file.size !== r.size || file.lastModified !== r.lastModified))
      throw new Error(t('ha cambiado durante el escaneo', 'changed during the scan'));
    return await hasher.hash(file, strategy, { signal: s.abort.signal });
  } catch (e) {
    if (!alive(s)) return null;
    s.errors++;
    feedLine('✗  ' + r.path + ' — ' + errMsg(e), 'err');
    return null;
  }
}

function addGroupToList(g) {
  const ext = extOf(g.files[0].name);
  vs.add(g.key); // si su formato está filtrado, queda oculto sin mover el scroll
  addExtToFilter(ext);
  updateStatsSoon();
}

/* ═══════════════════════════════════════════════════════════
   SELECTION
═══════════════════════════════════════════════════════════ */
const rowOf = id => document.querySelector(`[data-row="${Number(id)}"]`);

function markRow(id, on) {
  const row = rowOf(id);
  if (!row) return;
  row.classList.toggle('sel', on);
  const cb = row.querySelector('input[type=checkbox]');
  if (cb) cb.checked = on;
}

function toggleSel(id, checked, el) {
  const s   = scan;
  const rec = s?.index.files.get(id);
  const g   = s?.index.groupOf(rec);
  // El original de cada grupo nunca se puede seleccionar
  if (!s || s.limited || !rec || !g || s.index.keeperOf(g) === rec || rec.canDelete === false) {
    if (el) el.checked = false;
    return;
  }
  checked ? s.sel.add(id) : s.sel.delete(id);
  markRow(id, checked);
  updateSelectionUI();
}

function selectAll() {
  const s = scan;
  if (!s || s.limited) return;
  for (const g of s.index.dupGroups()) {
    for (const r of g.files.slice(1)) {
      if (r.canDelete === false || s.sel.has(r.id)) continue;
      s.sel.add(r.id);
      markRow(r.id, true);
    }
  }
  updateSelectionUI();
}

function deselectAll() {
  const s = scan;
  if (!s) return;
  for (const id of s.sel) markRow(id, false);
  s.sel.clear();
  updateSelectionUI();
}

function updateSelectionUI() {
  const s    = scan;
  const n    = s ? s.sel.size : 0;
  const size = s ? [...s.sel].reduce((sum, id) => sum + (s.index.files.get(id)?.size || 0), 0) : 0;
  const canRemove = s && !s.limited && s.done && !removing && n > 0;
  $('btn-del').style.display = canRemove ? 'block' : 'none';
  $('sel-cnt').textContent   = n;
  const infoEl = $('sel-info');
  if (n === 0) {
    infoEl.style.display = 'none';
  } else {
    const label = n === 1
      ? t('1 archivo seleccionado', '1 file selected')
      : t(n + ' archivos seleccionados', n + ' files selected');
    infoEl.textContent   = '▶ ' + label + ' · ' + fmtSize(size);
    infoEl.style.display = 'inline';
  }
}

/* ═══════════════════════════════════════════════════════════
   STATISTICS
═══════════════════════════════════════════════════════════ */
function updateStats() {
  const s = scan;
  $('st-files').textContent = s ? s.fileCount : 0;
  $('scan-cnt').textContent = s ? s.fileCount + ' ' + t('archivos', 'files') : '';
  const n = s ? s.index.dupGroupCount : 0;
  const w = s ? s.index.recoverableBytes() : 0;
  $('st-size').textContent = w > 0 ? fmtSize(w) : '—';
  const badge = $('dupe-badge');
  badge.textContent = n;
  badge.classList.toggle('z', n === 0);
}

/* ═══════════════════════════════════════════════════════════
   FILE PREVIEW
═══════════════════════════════════════════════════════════ */
async function previewFile(id) {
  const s  = scan;
  const fi = s?.index.files.get(id);
  if (!fi) return;
  const group = s.index.groupOf(fi);

  closePreview();
  $('prev-empty').style.display     = 'none';
  $('btn-close-prev').style.display = 'block';
  const $c = $('prev-content');
  $c.style.display = 'block';
  $('prev-lbl').textContent = fi.name;

  $c.innerHTML = `
    <div style="margin-bottom:12px;">
      <div class="pv-name">${esc(fi.name)}</div>
      <div class="pv-meta">${esc(fi.dir)} &nbsp;&middot;&nbsp; <span class="ac">${fmtSize(fi.size)}</span></div>
    </div>
    <div id="pv-loading" style="color:var(--dim);font-family:'Fira Code',monospace;font-size:.72rem;text-align:center;padding:20px;">
      ${esc(t('Cargando…', 'Loading…'))}
    </div>`;

  if (window.innerWidth <= 768)
    $('panel-right').scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const file = fi.fileObj ? fi.fileObj : await fi.handle.getFile();
    $('pv-loading')?.remove();

    if (isImg(fi.name)) {
      const url  = URL.createObjectURL(file);
      const wrap = document.createElement('div');
      wrap.style.cssText = 'text-align:center;';
      const img  = document.createElement('img');
      img.style.cssText  = 'max-width:100%;max-height:calc(100vh - 160px);border-radius:4px;border:1px solid var(--border);display:block;margin:0 auto;';
      img.src    = url; img.alt = fi.name;
      img.onload = img.onerror = () => URL.revokeObjectURL(url);
      wrap.appendChild(img); $c.appendChild(wrap);

    } else if (isVideo(fi.name)) {
      const url   = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.controls = true; video.preload = 'metadata';
      video.style.cssText = 'max-width:100%;max-height:calc(100vh - 200px);border-radius:4px;border:1px solid var(--border);display:block;margin:0 auto;background:#000;';
      video.src = url;
      video.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
      $c.appendChild(video);
      const note = document.createElement('div');
      note.style.cssText = 'font-family:"Fira Code",monospace;font-size:.6rem;color:var(--muted);margin-top:7px;text-align:right;';
      note.textContent   = '.' + extOf(fi.name) + ' · ' + fmtSize(fi.size);
      $c.appendChild(note);

    } else if (isAudio(fi.name)) {
      const url   = URL.createObjectURL(file);
      const wrap  = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:28px 14px;text-align:center;';
      const ico   = document.createElement('i');
      ico.className      = getIcon(fi.name);
      ico.style.cssText  = 'font-size:3rem;color:var(--dim);';
      const audio = document.createElement('audio');
      audio.controls = true; audio.preload = 'metadata';
      audio.style.cssText = 'width:100%;max-width:270px;';
      audio.src = url;
      audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
      const note = document.createElement('div');
      note.style.cssText = 'font-family:"Fira Code",monospace;font-size:.62rem;color:var(--muted);';
      note.textContent   = '.' + extOf(fi.name) + ' · ' + fmtSize(fi.size);
      wrap.appendChild(ico); wrap.appendChild(audio); wrap.appendChild(note);
      $c.appendChild(wrap);

    } else if (isTxt(fi.name) && fi.size < 1048576) {
      const text = await file.text();
      const ext  = extOf(fi.name);
      const pre  = document.createElement('pre');
      pre.style.cssText  = `font-family:'Fira Code',monospace;font-size:.72rem;line-height:1.65;color:var(--white);background:var(--code-bg);padding:12px;border-radius:4px;border:1px solid var(--border);white-space:pre-wrap;word-break:break-all;max-height:calc(100vh - 160px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--red) transparent;`;
      pre.textContent    = text.length > 12000 ? text.substring(0, 12000) + '\n… (' + t('truncado', 'truncated') + ')' : text;
      $c.appendChild(pre);
      const note = document.createElement('div');
      note.style.cssText = 'font-family:"Fira Code",monospace;font-size:.6rem;color:var(--muted);margin-top:5px;text-align:right;';
      note.textContent   = (ext ? '.' + ext : t('sin extensión', 'no ext')) + ' · ' + fmtSize(fi.size);
      $c.appendChild(note);

    } else if (isPdf(fi.name)) {
      const url   = URL.createObjectURL(file);
      const embed = document.createElement('embed');
      embed.src  = url; embed.type = 'application/pdf';
      embed.style.cssText = 'width:100%;height:calc(100vh - 160px);border:1px solid var(--border);border-radius:4px;';
      $c.appendChild(embed);

    } else {
      const ext = extOf(fi.name);
      const note = group?.sampled
        ? t('Archivo binario — sin previsualización.<br>Coincide con las otras copias por muestras (inicio, centro y final). Antes de quitarlo se comprobará el archivo completo.',
            'Binary file — no preview available.<br>Matches the other copies by samples (start, middle and end). The full file is checked before removing it.')
        : t('Archivo binario — sin previsualización.<br>Contenido byte a byte idéntico al del resto de copias (mismo SHA-256).',
            'Binary file — no preview available.<br>Content is byte-for-byte identical to all other copies (same SHA-256).');
      const d = document.createElement('div');
      d.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px;padding:28px 16px;text-align:center;';
      d.innerHTML = `
        <i class="${getIcon(fi.name)}" style="font-size:3.5rem;color:var(--dim);"></i>
        <div style="font-size:1rem;font-weight:700;color:var(--white);">${ext ? '.' + esc(ext) : esc(t('sin extensión', 'no extension'))}</div>
        <div style="font-size:1.35rem;font-weight:700;color:var(--red);">${fmtSize(fi.size)}</div>
        <div style="font-family:'Fira Code',monospace;font-size:.63rem;color:var(--muted);max-width:220px;line-height:1.7;">${note}</div>`;
      $c.appendChild(d);
    }
  } catch (e) {
    $('pv-loading')?.remove();
    const err = document.createElement('div');
    err.style.cssText = "color:var(--red);font-size:.72rem;font-family:'Fira Code',monospace;margin-top:8px;";
    err.textContent   = t('Error al cargar', 'Error loading') + ': ' + errMsg(e);
    $c.appendChild(err);
  }
}

function closePreview() {
  for (const el of document.querySelectorAll('#prev-content video, #prev-content audio, #prev-content embed')) {
    if (el.src?.startsWith('blob:')) URL.revokeObjectURL(el.src);
  }
  $('prev-content').innerHTML       = '';
  $('prev-content').style.display   = 'none';
  $('prev-empty').style.display     = 'flex';
  $('btn-close-prev').style.display = 'none';
  $('prev-lbl').textContent         = '';
}

/* ═══════════════════════════════════════════════════════════
   RESET
═══════════════════════════════════════════════════════════ */
function resetApp() {
  cancelScan(scan);
  scan = null; pending = null;

  closePreview();
  vs.reset();
  closeModal();
  $('mobile-input').value = '';
  resetFilterBar();
  $('limited-warn').style.display = hasFSAPI() ? 'none' : 'block';

  showScreen('home');
  clearFeed(FEED_PLACEHOLDER);

  setDot('idle', t('inactivo', 'idle'));
  $('scan-cnt').textContent    = '';
  $('pbar').style.width        = '0%';
  $('btn-stop').style.display  = 'none';
  $('btn-reset').style.display = 'none';
  $('nav-folder').style.display = 'none';
  $('panel-left').classList.remove('mobile-open');
  $('mobile-feed-btn').classList.remove('feed-visible');
  updateStats(); updateSelectionUI(); updateCompatNote();
}

/* ═══════════════════════════════════════════════════════════
   REMOVAL MODAL  (cuarentena por defecto, borrado definitivo opcional)
═══════════════════════════════════════════════════════════ */
const removalMode = () =>
  document.querySelector('input[name="del-mode"]:checked')?.value === 'delete' ? 'delete' : 'quarantine';

function openModal() {
  const s = scan;
  if (!s || s.limited || !s.done || removing || s.sel.size === 0) return;
  const list = $('modal-list');
  list.innerHTML = '';
  for (const id of s.sel) {
    const fi = s.index.files.get(id);
    if (!fi) continue;
    const d = document.createElement('div');
    d.textContent = fi.path;
    list.appendChild(d);
  }
  document.querySelector('input[name="del-mode"][value="quarantine"]').checked = true;
  setDelMode('quarantine');
  $('modal-input').value = '';
  updateConfirmState();
  $('modal-ov').classList.add('on');
}

function setDelMode(mode) {
  const del = mode === 'delete';
  $('mode-quarantine').classList.toggle('selected', !del);
  $('mode-delete').classList.toggle('selected', del);
  $('confirm-wrap').style.display  = del ? 'block' : 'none';
  $('btn-confirm-q').style.display = del ? 'none' : '';
  $('btn-confirm-d').style.display = del ? '' : 'none';
  $('btn-confirm-icon').className  = del ? 'fas fa-trash-alt' : 'fas fa-box-archive';
  if (del) $('modal-input').focus();
  updateConfirmState();
}

const confirmTyped = () => $('modal-input').value.trim() === t('CONFIRMAR', 'CONFIRM');

function updateConfirmState() {
  $('btn-confirm').disabled = removalMode() === 'delete' && !confirmTyped();
}

function closeModal() { $('modal-ov').classList.remove('on'); }

const REASON_TEXT = {
  [REFUSE.KEEPER]:          ['es el original que se conserva', 'it is the original being kept'],
  [REFUSE.MISSING]:         ['ya no forma parte de un grupo de duplicados', 'no longer part of a duplicate set'],
  [REFUSE.READ_ONLY]:       ['el navegador no permite modificarlo', 'the browser does not allow changing it'],
  [REFUSE.KEEPER_CHANGED]:  ['el original ha cambiado o ya no existe', 'the original changed or no longer exists'],
  [REFUSE.TARGET_CHANGED]:  ['el archivo ha cambiado o ya no existe', 'the file changed or no longer exists'],
  [REFUSE.CONTENT_DIFFERS]: ['el contenido completo NO es idéntico al original', 'the full content is NOT identical to the original'],
  [REFUSE.SAME_FILE]:       ['es el mismo archivo que el original', 'it is the same file as the original'],
};
const reasonText = r => t(...(REASON_TEXT[r] || [r, r]));

async function execRemoval() {
  const s = scan;
  if (!s || s.limited || !s.done || removing) return;
  const mode = removalMode();
  if (mode === 'delete' && !confirmTyped()) return;

  closeModal();
  removing = true;
  updateSelectionUI();
  setDot('run', t('verificando…', 'verifying…'));
  feedLine('─────────────────────────────', 'info');

  const { actions, refused } = planRemoval(s.index, [...s.sel]);
  let moved = 0, skipped = 0;
  for (const r of refused) {
    feedLine('⚠  ' + t('No se toca', 'Left alone') + ': ' + (r.rec?.path ?? '#' + r.id) + ' — ' + reasonText(r.reason), 'err');
    s.sel.delete(r.id); markRow(r.id, false); skipped++;
  }

  const cache    = new Map();
  const readFile = rec => rec.handle.getFile();
  const fullHash = file => hasher.hash(file, 'full');

  try {
    for (const { rec, keeper } of actions) {
      if (s !== scan) return;
      feedLine('🔎 ' + t('Verificando', 'Verifying') + ': ' + rec.path, 'file');
      const v = await verifyBeforeRemoval({ keeper, target: rec, readFile, fullHash, cache });
      if (s !== scan) return;
      if (!v.ok) {
        feedLine('⚠  ' + t('No se toca', 'Left alone') + ': ' + rec.path + ' — ' + reasonText(v.reason), 'err');
        s.sel.delete(rec.id); markRow(rec.id, false); skipped++;
        continue;
      }

      try {
        if (mode === 'quarantine') {
          const dest = await moveToQuarantine({
            root: s.root, relDir: rec.relDir, parent: rec.parent, handle: rec.handle, name: rec.name,
            fullHash, expectedHash: v.hash,
          });
          feedLine('📦 ' + t('A cuarentena', 'Quarantined') + ': ' + rec.path + ' → ' + dest, 'match');
        } else {
          await removeFile({ parent: rec.parent, handle: rec.handle, name: rec.name });
          feedLine('🗑  ' + t('Eliminado', 'Deleted') + ': ' + rec.path, 'match');
        }
      } catch (e) {
        feedLine('✗  ' + t('Error', 'Error') + ': ' + rec.path + ' — ' + errMsg(e), 'err');
        s.sel.delete(rec.id); markRow(rec.id, false); skipped++;
        continue;
      }
      if (s !== scan) return;

      moved++;
      s.sel.delete(rec.id);
      const { group, dissolved } = s.index.removeFile(rec.id);
      if (group) dissolved ? vs.remove(group.key) : vs.update(group.key);
      updateStats(); updateSelectionUI();
    }
  } finally {
    removing = false;
    if (s === scan) {
      setDot('idle', t('completado', 'done'));
      updateStats(); updateSelectionUI();
    }
  }

  feedLine(
    '✓  ' + moved + ' ' + (mode === 'quarantine' ? t('movidos a cuarentena', 'moved to quarantine') : t('eliminados', 'deleted')) +
    (skipped ? ' · ' + skipped + ' ' + t('sin tocar', 'left alone') : ''),
    'ok'
  );
  if (s.index.dupGroups().length === 0) showOkScreen(s);
}

/* ═══════════════════════════════════════════════════════════
   PWA — manifest.webmanifest + sw.js (funciona sin conexión tras la primera carga)
═══════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(err =>
    console.warn('[DupeCleaner] Service worker registration failed:', err));
}
