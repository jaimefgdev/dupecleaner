// Reglas de qué carpetas y archivos se escanean.
import { QUARANTINE_DIR } from './quarantine.js';

export const BLOCKED = new Set([
  'windows','system32','syswow64','program files','program files (x86)',
  'programdata','system volume information','$recycle.bin','recovery',
  'boot','efi','winsxs','drivers','assembly','windowsapps',
  'windowspowershell','microsoft.net','servicing','installer','prefetch',
  'system','library','private','cores','developer',
  'volumes','.trashes','.spotlight-v100','.fseventsd','macos',
  'bin','sbin','usr','etc','proc','dev','sys','run',
  'lib','lib64','lib32','libx32','srv','snap','lost+found',
]);

export const DEV_FOLDERS = new Set([
  'node_modules','.git','.cache','dist','__pycache__',
  '.next','.nuxt','.turbo','.parcel-cache','coverage',
  '.svelte-kit','out','build','.tox','venv','.venv',
]);

export const SYS_EXTENSIONS = new Set([
  'ini','sys','dll','lnk','bat','cmd','drv',
  'msi','inf','cat','evt','evtx','reg','scr',
]);

export const DEFAULT_CFG = Object.freeze({
  ignoreDev: true, ignoreHidden: false, ignoreSysFiles: false, minFileSize: 0, strategy: 'sample',
});

export const isBlocked = path =>
  path.toLowerCase().replace(/\\/g, '/').split('/').some(p => BLOCKED.has(p));

export const isIgnoredDir = (name, cfg) => {
  if (name === QUARANTINE_DIR)                                  return true; // nunca re-escanear la cuarentena
  if (cfg.ignoreDev    && DEV_FOLDERS.has(name.toLowerCase()))  return true;
  if (cfg.ignoreHidden && name.startsWith('.'))                 return true;
  return false;
};

export const isIgnoredFile = (name, cfg) => {
  if (!cfg.ignoreSysFiles) return false;
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return SYS_EXTENSIONS.has(ext);
};
