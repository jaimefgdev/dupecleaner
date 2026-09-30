// Reglas de seguridad antes de mover o borrar archivos.
// Principio: ante cualquier duda, no se toca nada.

export const REFUSE = Object.freeze({
  KEEPER:          'keeper',          // se intentó borrar el archivo que se conserva
  MISSING:         'missing',         // el archivo ya no está en el índice
  READ_ONLY:       'read-only',       // el navegador no permite borrarlo
  KEEPER_CHANGED:  'keeper-changed',  // el original cambió o desapareció tras el escaneo
  TARGET_CHANGED:  'target-changed',  // la copia cambió o desapareció tras el escaneo
  CONTENT_DIFFERS: 'content-differs', // el hash completo no coincide
  SAME_FILE:       'same-file',       // original y copia son el mismo archivo
});

/**
 * Decide qué se puede quitar a partir de la selección.
 * Nunca incluye el archivo que se conserva de cada grupo, así que cada grupo
 * conserva siempre al menos un archivo.
 */
export function planRemoval(index, selectedIds) {
  const actions = [];
  const refused = [];
  for (const id of selectedIds) {
    const rec = index.files.get(id);
    if (!rec) { refused.push({ id, rec: null, reason: REFUSE.MISSING }); continue; }
    const group = index.groupOf(rec);
    if (!group || group.files.length < 2) { refused.push({ id, rec, reason: REFUSE.MISSING }); continue; }
    const keeper = index.keeperOf(group);
    if (keeper.id === rec.id)  { refused.push({ id, rec, reason: REFUSE.KEEPER }); continue; }
    if (rec.canDelete === false || !rec.handle) { refused.push({ id, rec, reason: REFUSE.READ_ONLY }); continue; }
    actions.push({ rec, keeper, group });
  }
  return { actions, refused };
}

const unchanged = (file, rec) => file.size === rec.size && file.lastModified === rec.lastModified;

/**
 * Comprueba justo antes de quitar `target` que sigue siendo idéntico a `keeper`:
 *  1. ambos existen y no han cambiado (tamaño y fecha) desde el escaneo;
 *  2. el SHA-256 COMPLETO de los dos coincide, aunque el escaneo usara muestras.
 *
 * readFile(rec) → Promise<File> recién leído del disco.
 * fullHash(file) → Promise<string> con el SHA-256 de todo el contenido.
 * cache: Map opcional para no recalcular el hash del original en cada copia.
 */
export async function verifyBeforeRemoval({ keeper, target, readFile, fullHash, cache }) {
  if (keeper.id === target.id) return { ok: false, reason: REFUSE.SAME_FILE };
  if (keeper.handle && target.handle && typeof keeper.handle.isSameEntry === 'function') {
    try {
      if (await keeper.handle.isSameEntry(target.handle)) return { ok: false, reason: REFUSE.SAME_FILE };
    } catch { /* sin información: seguimos con el resto de comprobaciones */ }
  }

  let keeperFile, targetFile;
  try { keeperFile = await readFile(keeper); } catch { return { ok: false, reason: REFUSE.KEEPER_CHANGED }; }
  if (!unchanged(keeperFile, keeper))           return { ok: false, reason: REFUSE.KEEPER_CHANGED };
  try { targetFile = await readFile(target); } catch { return { ok: false, reason: REFUSE.TARGET_CHANGED }; }
  if (!unchanged(targetFile, target))           return { ok: false, reason: REFUSE.TARGET_CHANGED };

  let keeperHash, targetHash;
  const cacheKey = keeper.id + ':' + keeperFile.lastModified + ':' + keeperFile.size;
  try {
    keeperHash = cache?.get(cacheKey) ?? await fullHash(keeperFile);
    cache?.set(cacheKey, keeperHash);
  } catch { return { ok: false, reason: REFUSE.KEEPER_CHANGED }; }
  try { targetHash = await fullHash(targetFile); } catch { return { ok: false, reason: REFUSE.TARGET_CHANGED }; }

  if (keeperHash !== targetHash) return { ok: false, reason: REFUSE.CONTENT_DIFFERS };
  return { ok: true, hash: keeperHash };
}
