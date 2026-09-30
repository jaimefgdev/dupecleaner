// Sistema de archivos en memoria que imita la File System Access API.
// Solo para pruebas unitarias: nunca toca el disco.

const err = (name, msg) => Object.assign(new Error(msg || name), { name });
let clock = 1_700_000_000_000;

export class FakeFile {
  constructor(name, data = new Uint8Array(0), { withMove = true, withRemove = true } = {}) {
    this.kind = 'file';
    this.name = name;
    this._data = data;
    this._mtime = ++clock;
    this._parent = null;
    if (!withMove)   this.move   = undefined;
    if (!withRemove) this.remove = undefined;
  }
  async getFile() {
    if (!this._parent) throw err('NotFoundError');
    return new File([this._data], this.name, { lastModified: this._mtime });
  }
  write(data) { this._data = typeof data === 'string' ? new TextEncoder().encode(data) : data; this._mtime = ++clock; }
  async isSameEntry(other) { return other === this; }
  async createWritable() {
    const chunks = [];
    return new WritableStream({
      write: c => { chunks.push(new Uint8Array(c)); },
      close: () => { this.write(new Uint8Array(Buffer.concat(chunks))); },
    });
  }
  async move(dest, newName) {
    if (!this._parent) throw err('NotFoundError');
    this._parent._entries.delete(this.name);
    this.name = newName;
    dest._adopt(this);
  }
  async remove() { if (!this._parent) throw err('NotFoundError'); this._parent._entries.delete(this.name); this._parent = null; }
}

export class FakeDir {
  constructor(name, fileOpts = {}) { this.kind = 'directory'; this.name = name; this._entries = new Map(); this._fileOpts = fileOpts; this._parent = null; }
  _adopt(h) { h._parent = this; this._entries.set(h.name, h); return h; }
  async getDirectoryHandle(name, { create = false } = {}) {
    const h = this._entries.get(name);
    if (h) { if (h.kind !== 'directory') throw err('TypeMismatchError'); return h; }
    if (!create) throw err('NotFoundError');
    return this._adopt(new FakeDir(name, this._fileOpts));
  }
  async getFileHandle(name, { create = false } = {}) {
    const h = this._entries.get(name);
    if (h) { if (h.kind !== 'file') throw err('TypeMismatchError'); return h; }
    if (!create) throw err('NotFoundError');
    return this._adopt(new FakeFile(name, new Uint8Array(0), this._fileOpts));
  }
  async removeEntry(name) {
    const h = this._entries.get(name);
    if (!h) throw err('NotFoundError');
    this._entries.delete(name); h._parent = null;
  }
  async *entries() { for (const e of [...this._entries]) yield e; }

  /** Crea archivos a partir de { 'a/b.txt': 'contenido' } */
  static tree(spec, fileOpts) {
    const root = new FakeDir('root', fileOpts);
    for (const [path, content] of Object.entries(spec)) {
      const parts = path.split('/');
      let d = root;
      for (const p of parts.slice(0, -1)) {
        d = d._entries.get(p) || d._adopt(new FakeDir(p, fileOpts));
      }
      const f = new FakeFile(parts.at(-1), new TextEncoder().encode(content), fileOpts);
      d._adopt(f);
    }
    return root;
  }

  /** Lista plana { ruta: texto } */
  dump(prefix = '') {
    const out = {};
    for (const [n, h] of this._entries) {
      const p = prefix ? prefix + '/' + n : n;
      if (h.kind === 'file') out[p] = new TextDecoder().decode(h._data);
      else Object.assign(out, h.dump(p));
    }
    return out;
  }

  /** Handle de archivo por ruta */
  at(path) {
    let h = this;
    for (const p of path.split('/')) h = h._entries.get(p);
    return h;
  }
}
