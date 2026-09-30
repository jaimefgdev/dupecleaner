// Reglas de qué carpetas y archivos se escanean.
//
// Las carpetas del sistema operativo solo se bloquean cuando la carpeta
// elegida parece la raíz de un sistema (C:\, / o el disco de macOS) y solo
// en el primer nivel. Así una carpeta "lib", "bin" o "system" dentro de un
// proyecto o de Documentos se escanea con normalidad.
import { QUARANTINE_DIR } from './quarantine.js';
import { extOf } from './format.js';

/* Carpetas de sistema por SO, bloqueadas solo en el primer nivel de una raíz de sistema */
export const SYSTEM_ROOT_DIRS = {
  windows: new Set([
    'windows', 'program files', 'program files (x86)', 'programdata',
    'recovery', 'boot', 'efi', '$windows.~bt', '$windows.~ws', '$winreagent',
  ]),
  macos: new Set([
    'system', 'library', 'private', 'cores', 'volumes', 'bin', 'sbin', 'usr', 'etc',
    'dev', 'opt', 'var', 'tmp',
  ]),
  linux: new Set([
    'bin', 'sbin', 'usr', 'etc', 'proc', 'dev', 'sys', 'run', 'boot', 'lib', 'lib32',
    'lib64', 'libx32', 'srv', 'snap', 'var', 'tmp', 'opt', 'lost+found',
  ]),
};

/* Carpetas que solo contienen datos internos del sistema, estén donde estén */
export const ALWAYS_SKIPPED = new Set([
  '$recycle.bin', 'system volume information', '.trashes', '.spotlight-v100',
  '.fseventsd', '.documentrevisions-v100', '.temporaryitems', 'lost+found',
]);

export const DEV_FOLDERS = new Set([
  'node_modules', '.git', '.cache', 'dist', '__pycache__',
  '.next', '.nuxt', '.turbo', '.parcel-cache', 'coverage',
  '.svelte-kit', 'out', 'build', '.tox', 'venv', '.venv',
]);

export const SYS_EXTENSIONS = new Set([
  'ini', 'sys', 'dll', 'lnk', 'bat', 'cmd', 'drv',
  'msi', 'inf', 'cat', 'evt', 'evtx', 'reg', 'scr',
]);

export const DEFAULT_CFG = Object.freeze({
  ignoreDev: true, ignoreHidden: false, ignoreSysFiles: false, minFileSize: 0, strategy: 'sample',
});

/** Motivos de omisión, para mostrarlos en el registro */
export const SKIP = Object.freeze({
  SYSTEM:     'system',
  QUARANTINE: 'quarantine',
  DEV:        'dev',
  HIDDEN:     'hidden',
});

/**
 * A partir de los nombres del primer nivel de la carpeta elegida, dice si
 * parece la raíz de un sistema operativo: 'windows' | 'macos' | 'linux' | null.
 */
export function detectSystemRoot(childNames) {
  const n   = new Set([...childNames].map(s => s.toLowerCase()));
  const has = (...xs) => xs.every(x => n.has(x));
  if (has('windows') && (n.has('program files') || n.has('users'))) return 'windows';
  if (has('system', 'library') && (n.has('applications') || n.has('users'))) return 'macos';
  if (has('etc', 'usr') && (n.has('bin') || n.has('proc') || n.has('var'))) return 'linux';
  return null;
}

/**
 * ¿Hay que omitir la carpeta `name`, que está a profundidad `depth`
 * (1 = hija directa de la carpeta elegida)? Devuelve el motivo o null.
 */
export function dirSkipReason(name, depth, systemRoot, cfg) {
  const lower = name.toLowerCase();
  if (name === QUARANTINE_DIR)                                   return SKIP.QUARANTINE;
  if (ALWAYS_SKIPPED.has(lower))                                 return SKIP.SYSTEM;
  if (systemRoot && depth === 1 && SYSTEM_ROOT_DIRS[systemRoot].has(lower)) return SKIP.SYSTEM;
  if (cfg.ignoreDev    && DEV_FOLDERS.has(lower))                return SKIP.DEV;
  if (cfg.ignoreHidden && name.startsWith('.'))                  return SKIP.HIDDEN;
  return null;
}

export const isIgnoredFile = (name, cfg) => cfg.ignoreSysFiles && SYS_EXTENSIONS.has(extOf(name));

/** Opciones guardadas (JSON de localStorage) validadas; lo desconocido o inválido se ignora */
export function parseStoredCfg(json) {
  let raw;
  try { raw = JSON.parse(json); } catch { return {}; }
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const k of ['ignoreDev', 'ignoreHidden', 'ignoreSysFiles'])
    if (typeof raw[k] === 'boolean') out[k] = raw[k];
  if (Number.isFinite(raw.minFileSize) && raw.minFileSize >= 0) out.minFileSize = Math.round(raw.minFileSize);
  if (raw.strategy === 'sample' || raw.strategy === 'full') out.strategy = raw.strategy;
  return out;
}
