// Modelo puro del escaneo: archivos encontrados y grupos de duplicados.
// Cada escaneo tiene su propio índice, así un escaneo cancelado no puede
// contaminar los resultados del siguiente.

export class DupeIndex {
  constructor() {
    this.files  = new Map(); // id → registro de archivo
    this.groups = new Map(); // key → { key, hash, size, sampled, files: [registro, ...] }
    this._seq   = 0;
  }

  /**
   * Registra un archivo. rec: { path, name, dir, relDir, size, lastModified,
   * handle?, parent?, fileObj?, canDelete }. Devuelve el registro con su id.
   */
  addFile(rec) {
    const r = { ...rec, id: ++this._seq, hash: null, groupKey: null };
    this.files.set(r.id, r);
    return r;
  }

  /** Grupos de archivos con el mismo tamaño (los únicos que pueden ser duplicados) */
  sizeCandidates() {
    const bySize = new Map();
    for (const r of this.files.values()) {
      if (!bySize.has(r.size)) bySize.set(r.size, []);
      bySize.get(r.size).push(r);
    }
    return [...bySize.values()].filter(g => g.length > 1);
  }

  /**
   * Añade el hash de un archivo a su grupo. `sampled` indica que el hash solo
   * cubre muestras del archivo (coincidencia probable, no demostrada).
   * La clave del grupo incluye el tamaño: dos archivos de distinto tamaño
   * nunca pueden acabar en el mismo grupo, aunque sus muestras coincidan.
   */
  addHash(rec, hash, sampled = false) {
    const key = rec.size + ':' + hash;
    rec.hash = hash;
    rec.groupKey = key;
    let g = this.groups.get(key);
    if (!g) { g = { key, hash, size: rec.size, sampled: false, files: [] }; this.groups.set(key, g); }
    g.sampled = g.sampled || sampled;
    g.files.push(rec);
    return g;
  }

  groupOf(rec) { return rec && rec.groupKey ? this.groups.get(rec.groupKey) : undefined; }

  /** El archivo que se conserva en cada grupo: el primero encontrado */
  keeperOf(group) { return group.files[0]; }

  dupGroups() { return [...this.groups.values()].filter(g => g.files.length > 1); }

  recoverableBytes() {
    return this.dupGroups().reduce((s, g) => s + g.size * (g.files.length - 1), 0);
  }

  /**
   * Quita un archivo (tras moverlo o borrarlo). Devuelve el grupo y si ha
   * dejado de ser un grupo de duplicados.
   */
  removeFile(id) {
    const rec = this.files.get(id);
    if (!rec) return { group: undefined, dissolved: false };
    this.files.delete(id);
    const group = this.groupOf(rec);
    if (!group) return { group: undefined, dissolved: false };
    group.files = group.files.filter(r => r.id !== id);
    const dissolved = group.files.length < 2;
    if (group.files.length === 0) this.groups.delete(group.key);
    return { group, dissolved };
  }
}
