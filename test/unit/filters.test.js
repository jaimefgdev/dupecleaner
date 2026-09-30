import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSystemRoot, dirSkipReason, isIgnoredFile, DEFAULT_CFG, SKIP } from '../../src/filters.js';

const cfg = { ...DEFAULT_CFG, ignoreDev: false, ignoreHidden: false };

test('detecta raíces de sistema solo con varias carpetas características', () => {
  assert.equal(detectSystemRoot(['Windows', 'Program Files', 'Users', 'PerfLogs']), 'windows');
  assert.equal(detectSystemRoot(['Applications', 'Library', 'System', 'Users', 'Volumes']), 'macos');
  assert.equal(detectSystemRoot(['bin', 'boot', 'etc', 'home', 'usr', 'var', 'proc']), 'linux');
  assert.equal(detectSystemRoot(['Fotos', 'lib', 'bin', 'System']), null);
  assert.equal(detectSystemRoot(['Windows']), null);
  assert.equal(detectSystemRoot([]), null);
});

test('carpetas con nombres "de sistema" dentro de una carpeta normal SÍ se escanean', () => {
  for (const name of ['lib', 'bin', 'system', 'Library', 'private', 'run', 'dev', 'boot', 'drivers', 'Developer', 'etc', 'usr']) {
    for (const depth of [1, 2, 5]) assert.equal(dirSkipReason(name, depth, null, cfg), null, `${name}@${depth}`);
  }
});

test('en una raíz de sistema se omiten sus carpetas del SO solo en el primer nivel', () => {
  assert.equal(dirSkipReason('Windows', 1, 'windows', cfg), SKIP.SYSTEM);
  assert.equal(dirSkipReason('Program Files', 1, 'windows', cfg), SKIP.SYSTEM);
  assert.equal(dirSkipReason('Users', 1, 'windows', cfg), null);
  assert.equal(dirSkipReason('Windows', 3, 'windows', cfg), null);   // p. ej. Users/yo/Proyectos/Windows
  assert.equal(dirSkipReason('lib', 1, 'linux', cfg), SKIP.SYSTEM);
  assert.equal(dirSkipReason('lib', 2, 'linux', cfg), null);
  assert.equal(dirSkipReason('home', 1, 'linux', cfg), null);
  assert.equal(dirSkipReason('System', 1, 'macos', cfg), SKIP.SYSTEM);
  assert.equal(dirSkipReason('lib', 1, 'macos', cfg), null);
});

test('papelera e índices del sistema se omiten a cualquier profundidad', () => {
  for (const name of ['$RECYCLE.BIN', 'System Volume Information', '.Trashes', '.Spotlight-V100', '.fseventsd'])
    assert.equal(dirSkipReason(name, 4, null, cfg), SKIP.SYSTEM, name);
});

test('carpetas de desarrollo y ocultas dependen de la configuración', () => {
  assert.equal(dirSkipReason('node_modules', 2, null, cfg), null);
  assert.equal(dirSkipReason('node_modules', 2, null, { ...cfg, ignoreDev: true }), SKIP.DEV);
  assert.equal(dirSkipReason('build', 1, null, { ...cfg, ignoreDev: true }), SKIP.DEV);
  assert.equal(dirSkipReason('.config', 2, null, cfg), null);
  assert.equal(dirSkipReason('.config', 2, null, { ...cfg, ignoreHidden: true }), SKIP.HIDDEN);
});

test('extensiones de sistema solo si se activa la opción', () => {
  assert.equal(isIgnoredFile('a.DLL', cfg), false);
  assert.equal(isIgnoredFile('a.DLL', { ...cfg, ignoreSysFiles: true }), true);
  assert.equal(isIgnoredFile('foto.jpg', { ...cfg, ignoreSysFiles: true }), false);
});
