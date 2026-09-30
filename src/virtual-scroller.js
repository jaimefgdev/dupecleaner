// Lista virtual: solo las tarjetas visibles están en el DOM.

/* ═══════════════════════════════════════════════════════════
   ② VIRTUAL SCROLLER  (DOM Windowing)
   ───────────────────────────────────────────────────────────
   • Only ~20 nodes live in the DOM at once.
   • Items are positioned with transform:translateY() —
     GPU-composited, no layout reflow on scroll.
   • Node pool: released nodes are recycled instead of GC'd.
   • Variable heights: estimated on add, measured after first
     paint, then tops are adjusted incrementally.
   • applyFilter(): recomputes visible subset and positions
     without touching already-measured heights.
═══════════════════════════════════════════════════════════ */
export class VirtualScroller {
  /**
   * hooks.estimate(key) → altura estimada en px
   * hooks.render(el, key) → rellena el nodo con la tarjeta del grupo
   * hooks.extOf(key) → extensión del grupo (para el filtro por formato)
   */
  constructor(scrollEl, spacerEl, hooks) {
    this._hooks   = hooks;
    this._scroll  = scrollEl;  // the overflow-y:auto container
    this._spacer  = spacerEl;  // the relative-positioned inner div
    this._items   = [];        // [{hash, top, height, ext, hidden}]
    this._idxMap  = new Map(); // hash → index in _items
    this._visible = [];        // indices currently filtered-in
    this._rendered = new Map();// hash → DOM element (in DOM right now)
    this._pool    = [];        // recycled divs waiting for reuse
    this._totalH  = 0;
    this._raf     = null;
    this._OVERSCAN = 3;

    scrollEl.addEventListener('scroll', () => this._sched(), { passive: true });
    // Re-render on resize (viewport height change)
    new ResizeObserver(() => this._sched()).observe(scrollEl);
  }

  /* ── Estimate item height from group file count ── */
  _est(hash) { return this._hooks.estimate(hash); }

  /* ── Add a new group to the list ── */
  add(hash) {
    const ext    = this._hooks.extOf(hash);
    const height = this._est(hash);
    const item   = { hash, top: this._totalH, height, ext, hidden: false };
    this._idxMap.set(hash, this._items.length);
    this._items.push(item);
    this._totalH += height;
    this._visible = this._buildVisible();
    this._spacer.style.height = this._totalH + 'px';
    this._sched();
  }

  /* ── Remove a group (after deletion) ── */
  remove(hash) {
    const idx = this._idxMap.get(hash);
    if (idx === undefined) return;

    // Release DOM node if currently rendered
    const el = this._rendered.get(hash);
    if (el) { this._release(el); this._rendered.delete(hash); }

    const item = this._items[idx];
    this._totalH -= item.height;

    // Shift tops of all items after this one
    for (let i = idx + 1; i < this._items.length; i++) {
      this._items[i].top -= item.height;
      // If currently rendered, update its transform immediately
      const rendEl = this._rendered.get(this._items[i].hash);
      if (rendEl) rendEl.style.transform = `translateY(${this._items[i].top}px)`;
    }

    this._items.splice(idx, 1);
    // Rebuild idxMap (indices shifted after removal point)
    this._idxMap.clear();
    for (let i = 0; i < this._items.length; i++) this._idxMap.set(this._items[i].hash, i);

    this._visible = this._buildVisible();
    this._spacer.style.height = this._totalH + 'px';
    this._sched();
  }

  /* ── Rebuild one group card (after its files changed) ── */
  update(hash) {
    const el = this._rendered.get(hash);
    if (el) { this._hooks.render(el, hash); this._measureLater(hash, el); }
    this._sched();
  }

  /* ── Rebuild every mounted card (e.g. after a language switch) ── */
  refreshAll() {
    for (const [hash, el] of this._rendered) { this._hooks.render(el, hash); this._measureLater(hash, el); }
  }

  /* ── Measure actual height after paint & shift the following items ── */
  _measureLater(hash, el) {
    requestAnimationFrame(() => {
      if (this._rendered.get(hash) !== el) return;
      const idx  = this._idxMap.get(hash);
      const item = this._items[idx];
      if (!item) return;
      const actual = el.offsetHeight + 16;
      if (Math.abs(actual - item.height) <= 3) return;
      const diff = actual - item.height;
      item.height = actual;
      if (item.hidden) return;
      this._totalH += diff;
      this._spacer.style.height = this._totalH + 'px';
      for (let i = idx + 1; i < this._items.length; i++) {
        if (this._items[i].hidden) continue;
        this._items[i].top += diff;
        const rEl = this._rendered.get(this._items[i].hash);
        if (rEl) rEl.style.transform = `translateY(${this._items[i].top}px)`;
      }
    });
  }

  /* ── Apply format filter — recomputes visible set & positions ── */
  setFilter(activeFilters) {
    // Mark each item as hidden or not
    for (const item of this._items) {
      item.hidden = activeFilters.size > 0 && !activeFilters.has(item.ext);
    }
    // Recompute tops for the filtered-visible subset
    let top = 0;
    for (const item of this._items) {
      if (!item.hidden) { item.top = top; top += item.height; }
    }
    this._totalH = top;
    this._spacer.style.height = this._totalH + 'px';
    this._visible = this._buildVisible();

    // Release everything currently rendered so _render() rebuilds from scratch
    for (const [, el] of this._rendered) this._release(el);
    this._rendered.clear();
    this._scroll.scrollTop = 0;
    this._sched();
  }

  /* ── Clear all state (scan reset) ── */
  reset() {
    for (const [, el] of this._rendered) this._release(el);
    this._rendered.clear();
    this._items.length = 0;
    this._idxMap.clear();
    this._visible.length = 0;
    this._pool.length = 0;
    this._totalH = 0;
    this._spacer.style.height = '0';
  }

  /* ── Node pool: acquire / release ── */
  _acquire() {
    const el = this._pool.pop() || document.createElement('div');
    el.className = 'vs-item';
    el.style.visibility = '';
    return el;
  }

  _release(el) {
    el.style.visibility = 'hidden';
    el.innerHTML = '';
    this._pool.push(el);
    // Keep pool bounded to avoid memory leaks
    if (this._pool.length > 40) this._pool.length = 40;
  }

  /* ── Build the filtered-visible index list ── */
  _buildVisible() {
    const v = [];
    for (let i = 0; i < this._items.length; i++) {
      if (!this._items[i].hidden) v.push(i);
    }
    return v;
  }

  _sched() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._render(); });
  }

  _render() {
    if (!this._visible.length) return;

    const scrollTop  = this._scroll.scrollTop;
    const viewH      = this._scroll.clientHeight;
    const N          = this._visible.length;
    const OVER       = this._OVERSCAN;

    /* Binary search: first visible item in _visible[] */
    let lo = 0, hi = N - 1, startV = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const item = this._items[this._visible[mid]];
      if (item.top + item.height < scrollTop) { startV = mid + 1; lo = mid + 1; }
      else hi = mid - 1;
    }
    const vStart = Math.max(0, startV - OVER);

    /* Linear scan to find end */
    let vEnd = vStart;
    while (vEnd < N && this._items[this._visible[vEnd]].top < scrollTop + viewH) vEnd++;
    vEnd = Math.min(N - 1, vEnd + OVER);

    /* Set of hashes that should be in DOM */
    const needed = new Set();
    for (let v = vStart; v <= vEnd; v++) {
      needed.add(this._items[this._visible[v]].hash);
    }

    /* Release items that scrolled out */
    for (const [hash, el] of this._rendered) {
      if (!needed.has(hash)) { this._release(el); this._rendered.delete(hash); }
    }

    /* Mount items that scrolled in */
    for (let v = vStart; v <= vEnd; v++) {
      const item = this._items[this._visible[v]];
      if (this._rendered.has(item.hash)) {
        // Already in DOM — just make sure transform is current
        this._rendered.get(item.hash).style.transform = `translateY(${item.top}px)`;
        continue;
      }

      const el = this._acquire();
      el.style.transform = `translateY(${item.top}px)`;
      this._hooks.render(el, item.hash);
      this._spacer.appendChild(el);
      this._rendered.set(item.hash, el);

      this._measureLater(item.hash, el);
    }
  }
}
