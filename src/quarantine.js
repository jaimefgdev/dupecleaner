// Mover a cuarentena o borrar archivos mediante la File System Access API.
// La cuarentena es una carpeta dentro de la carpeta escaneada que conserva la
// ruta relativa original, así se puede revisar y restaurar a mano.

export const QUARANTINE_DIR = '_dupecleaner_cuarentena';

/** Obtiene (creándolas si hace falta) las subcarpetas `parts` bajo `root` */
export async function ensureDir(root, parts) {
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  return dir;
}

async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; }
  catch (e) {
    if (e?.name === 'NotFoundError') return false;
    if (e?.name === 'TypeMismatchError') return true; // existe una carpeta con ese nombre
    throw e;
  }
}

/** "foto.jpg" → "foto (1).jpg" si ya existe, etc. */
export async function uniqueName(dir, name) {
  if (!(await exists(dir, name))) return name;
  const dot  = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot)    : '';
  for (let i = 1; i < 10000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(dir, candidate))) return candidate;
  }
  throw new Error('No free name in quarantine for ' + name);
}

const isUnsupported = e => e?.name === 'NotSupportedError' || e instanceof TypeError;

/**
 * Mueve `handle` (que está en `parent` con nombre `name`) a
 * root/QUARANTINE_DIR/relDir/. Devuelve la ruta relativa de destino.
 * Si el navegador no sabe mover, copia, comprueba la copia y solo entonces
 * borra el original. Si se pasan `fullHash` y `expectedHash`, la copia también
 * debe tener ese hash.
 */
export async function moveToQuarantine({ root, relDir, parent, handle, name, fullHash, expectedHash }) {
  const destParts = [QUARANTINE_DIR, ...relDir.filter(Boolean)];
  const dest      = await ensureDir(root, destParts);
  const finalName = await uniqueName(dest, name);
  const destPath  = [...destParts, finalName].join('/');

  if (typeof handle.move === 'function') {
    try { await handle.move(dest, finalName); return destPath; }
    catch (e) { if (!isUnsupported(e)) throw e; }
  }

  const src  = await handle.getFile();
  const out  = await dest.getFileHandle(finalName, { create: true });
  const w    = await out.createWritable();
  try {
    await src.stream().pipeTo(w); // pipeTo cierra el writable al terminar
  } catch (e) {
    try { await dest.removeEntry(finalName); } catch { /* nada más que hacer */ }
    throw e;
  }
  const copy = await out.getFile();
  const bad  = copy.size !== src.size || (fullHash && expectedHash && (await fullHash(copy)) !== expectedHash);
  if (bad) {
    try { await dest.removeEntry(finalName); } catch { /* nada más que hacer */ }
    throw new Error('Quarantine copy is incomplete');
  }
  await removeFile({ parent, handle, name });
  return destPath;
}

/** Borrado definitivo */
export async function removeFile({ parent, handle, name }) {
  if (parent && typeof parent.removeEntry === 'function') return parent.removeEntry(name);
  if (handle && typeof handle.remove === 'function')      return handle.remove();
  throw new Error('Delete not supported');
}
