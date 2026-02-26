// ChromaScale — UI Controller v3
// Compact 35-step layout with contrast constraint enforcement

const DEFAULTS = {
  Gray: ["#faf9f5","#f5f4ed","#f0eee6","#e8e6dc","#dedcd1","#d1cfc5","#c2c0b6","#b0aea5","#9c9a92","#87867f","#73726c","#5e5d59","#4d4c48","#3d3d3a","#30302e","#262624","#1f1e1d","#1a1918","#141413"],
  Red: ["#fceded","#f7c1c1","#f09595","#e86b6b","#e04343","#b53333","#8a2424","#5c1616","#300b0b"],
  Orange: ["#faefeb","#f5cbbc","#f2a88f","#ed8461","#e86235","#ba4c27","#8c3619","#5e230f","#301107"],
  Yellow: ["#faf3e8","#fae1b9","#facf89","#fabd5a","#faa72a","#c77f1a","#965b0e","#633806","#301901"],
  Green: ["#f1f7e9","#d0e5b1","#afd47d","#90bf4e","#76ad2a","#568c1c","#386910","#214708","#0e2402"],
  Aqua: ["#e9f7f2","#aee5d3","#7ad6b7","#4dc49c","#24b283","#188f6b","#0e6b54","#07473b","#02211c"],
  Blue: ["#edf5fc","#bad7f5","#86b8eb","#599ee3","#2c84db","#1b67b2","#0f4b87","#06325e","#011a33"],
  Violet: ["#f1f0ff","#cac6f5","#a49ee8","#827ade","#6258d1","#4d44ab","#383182","#26215c","#141133"],
  Magenta: ["#fcf0f4","#f5c6d6","#f0a1bb","#e87da1","#e05a87","#b54369","#8a2d4c","#5e1c32","#2e0b17"]
};

function defaultsConfig() {
  return {
    lightnessMax: 1.0,
    lightnessMin: 0.15,
    scales: Object.entries(DEFAULTS).map(([name, keyColors]) => ({ name, keyColors }))
  };
}

class App {
  constructor() {
    this.manager = new ScaleManager();
    this.store = new SetStore();
    this.curveEditor = null;
    this.root = document.getElementById('app');
    this._openSourcePanelId = null;
  }

  async init() {
    this.store.load();

    if (this.store.sets.length === 0) {
      const id = this.store.create('My Palette', defaultsConfig());
      this.store.switchTo(id);
    }

    // Check for shared URL — decode is async, so hold the result and
    // prompt after the user's own workspace has rendered underneath.
    let pendingImport = null;
    const hash = location.hash;
    if (hash.startsWith('#s=')) {
      try {
        pendingImport = await decodeSet(hash.slice(3));
      } catch (e) {
        // Invalid hash — we'll toast after render. Clear it now.
        this._pendingImportError = e.message;
      }
      history.replaceState(null, '', location.pathname + location.search);
    }

    this._loadConfigIntoManager(this.store.getActive().config);

    // Start with no scale selected — curve panel hidden until user clicks
    this.manager.selectedId = null;

    this._initTooltipSystem();
    this._render();
    this._scheduleGradientResize();

    if (pendingImport) {
      this._showImportConfirmation(pendingImport);
    } else if (this._pendingImportError) {
      this._showToast('Invalid share link: ' + this._pendingImportError, true);
      this._pendingImportError = null;
    }
  }



  _initTooltipSystem() {
    // Create shared popover tooltip element (lives in top layer, escapes overflow:hidden)
    const tip = document.createElement('div');
    tip.id = 'shared-tooltip';
    tip.setAttribute('popover', 'manual');
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    this._tooltip = tip;
    this._tooltipTimer = null;
    this._tooltipTarget = null;

    // Feature-detect CSS Anchor Positioning
    const hasAnchor = CSS.supports('anchor-name', '--x');

    const showTip = (trigger) => {
      // Remove anchor from previous target if different
      if (this._tooltipTarget && this._tooltipTarget !== trigger) {
        if (hasAnchor) this._tooltipTarget.style.anchorName = '';
      }

      this._tooltipTarget = trigger;

      // Set tooltip content and reset nudge
      tip.textContent = trigger.dataset.tooltip;
      tip.style.translate = '-50% 0';

      if (hasAnchor) {
        // CSS Anchor Positioning: let CSS handle placement
        trigger.style.anchorName = '--tip-anchor';
      } else {
        // Fallback: position via JS coordinates
        const rect = trigger.getBoundingClientRect();
        tip.style.setProperty('--tip-top', `${rect.top}px`);
        tip.style.setProperty('--tip-left', `${rect.left + rect.width / 2}px`);
      }

      // Show the popover
      try { tip.showPopover(); } catch(e) { /* already open */ }

      // Nudge horizontally if clipped by viewport edges
      const r = tip.getBoundingClientRect();
      const pad = 6;
      if (r.right > window.innerWidth - pad) {
        const shift = r.right - window.innerWidth + pad;
        tip.style.translate = `calc(-50% - ${shift}px) 0`;
      } else if (r.left < pad) {
        const shift = pad - r.left;
        tip.style.translate = `calc(-50% + ${shift}px) 0`;
      }
    };

    const hideTip = () => {
      clearTimeout(this._tooltipTimer);
      try { tip.hidePopover(); } catch(e) {}
      if (this._tooltipTarget) {
        if (hasAnchor) this._tooltipTarget.style.anchorName = '';
        this._tooltipTarget = null;
      }
    };
    
    // Use mouseover/mouseout (they bubble) for reliable delegation
    document.addEventListener('mouseover', (e) => {
      const trigger = e.target.closest('[data-tooltip]');
      if (!trigger || !trigger.dataset.tooltip) return;
      
      // If already showing this exact trigger, skip (prevents flicker on child transitions)
      if (this._tooltipTarget === trigger) {
        clearTimeout(this._tooltipTimer);
        return;
      }
      
      clearTimeout(this._tooltipTimer);
      
      // If another tooltip is already visible, switch instantly (no delay)
      if (this._tooltipTarget) {
        showTip(trigger);
      } else {
        // First tooltip: short delay
        this._tooltipTimer = setTimeout(() => showTip(trigger), 120);
      }
    });
    
    document.addEventListener('mouseout', (e) => {
      const trigger = e.target.closest('[data-tooltip]');
      if (!trigger) return;
      
      // Check if mouse moved to another child of the SAME trigger — if so, don't hide
      const related = e.relatedTarget;
      if (related && trigger.contains(related)) return;
      
      // Check if mouse moved to a DIFFERENT tooltip trigger — delay hide slightly
      // so the mouseover on the new trigger fires first and can cancel
      clearTimeout(this._tooltipTimer);
      this._tooltipTimer = setTimeout(() => hideTip(), 60);
    });
    
    // Hide on mousedown (during drag etc.) and scroll
    document.addEventListener('mousedown', hideTip);
    document.addEventListener('scroll', hideTip, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
  }

  _loadConfigIntoManager(config) {
    // ScaleManager.fromConfig handles legacy property names + curve points
    this.manager.fromConfig({
      lightnessMax: config.lightnessMax,
      lightnessMin: config.lightnessMin,
      scales: config.scales,
      selectedId: null
    });
  }

  _saveActiveSet() {
    // Persist full manager config (includes curve points) to the active set
    const cfg = this.manager.toConfig();
    delete cfg.selectedId; // UI-ephemeral, don't store
    this.store.updateActive(cfg);
  }

  _switchSet(id) {
    // Flush current edits, swap config, re-render
    this._saveActiveSet();
    const next = this.store.switchTo(id);
    this._loadConfigIntoManager(next.config);
    this.manager.selectedId = null;
    this._openSourcePanelId = null;
    this._render();
    this._scheduleGradientResize();
  }

  // ---- Set switcher dropdown (header-left quick switch) ----

  _toggleSetDropdown(anchor) {
    const existing = anchor.querySelector('.set-dropdown');
    if (existing) { existing.remove(); return; }
    document.querySelectorAll('.set-dropdown').forEach(d => d.remove());

    const activeId = this.store.activeId;
    const sets = this.store.list();

    const dd = document.createElement('div');
    dd.className = 'set-dropdown';

    sets.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'dropdown-item' + (s.id === activeId ? ' set-item-active' : '');
      btn.innerHTML = `
        <span class="set-item-dot"></span>
        <span class="dropdown-item-label">${s.name}</span>
        <span class="set-item-count">${s.config.scales.length}</span>
      `;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dd.remove();
        if (s.id !== activeId) this._switchSet(s.id);
      });
      dd.appendChild(btn);
    });

    const div = document.createElement('div');
    div.className = 'dropdown-divider';
    dd.appendChild(div);

    const mgmt = document.createElement('button');
    mgmt.className = 'dropdown-item';
    mgmt.innerHTML = `<span class="dropdown-item-icon">${icon('gear',14)}</span><span class="dropdown-item-label">Manage sets…</span>`;
    mgmt.addEventListener('click', (e) => {
      e.stopPropagation();
      dd.remove();
      this._showSetsModal();
    });
    dd.appendChild(mgmt);

    anchor.appendChild(dd);

    const closeOnOutside = (e) => {
      if (!dd.contains(e.target) && !anchor.contains(e.target)) {
        dd.remove();
        document.removeEventListener('mousedown', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 10);
  }

  // ---- Sets management modal ----

  _relTime(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  _showSetsModal() {
    document.querySelector('.modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.className = 'modal sets-modal';
    modal.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">Sets</h2>
        <button class="btn-icon btn-close-modal">${icon('x',16)}</button>
      </div>
      <div class="modal-body">
        <div class="sets-list"></div>
        <div class="sets-footer">
          <button class="btn btn-secondary" id="btn-new-set">${icon('plus',14)} New set</button>
        </div>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector('.btn-close-modal').addEventListener('click', () => overlay.remove());

    const openRename = (info, s) => {
      const nameEl = info.querySelector('[data-name]');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'set-rename-input';
      input.value = s.name;
      nameEl.replaceWith(input);
      input.focus(); input.select();
      const commit = () => {
        const val = input.value.trim() || s.name;
        this.store.rename(s.id, val);
        if (s.id === this.store.activeId) {
          const label = document.querySelector('.set-switcher-name');
          if (label) label.textContent = val;
        }
        renderList();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = s.name; input.blur(); }
      });
    };

    const renderList = (renameId = null) => {
      const list = modal.querySelector('.sets-list');
      list.innerHTML = '';
      const activeId = this.store.activeId;
      const sets = this.store.list();

      sets.forEach(s => {
        const card = document.createElement('div');
        card.className = 'set-card' + (s.id === activeId ? ' set-card-active' : '');
        card.dataset.setId = s.id;

        const strip = document.createElement('div');
        strip.className = 'set-swatch-strip';
        const first = s.config.scales[0];
        if (first) {
          const kc = first.keyColors;
          const pick = kc.length <= 5 ? kc : [0,1,2,3,4].map(i => kc[Math.floor(i * (kc.length-1) / 4)]);
          pick.forEach(hex => {
            const sw = document.createElement('span');
            sw.className = 'set-swatch';
            sw.style.backgroundColor = hex;
            strip.appendChild(sw);
          });
        }

        const info = document.createElement('div');
        info.className = 'set-card-info';
        info.innerHTML = `
          <div class="set-card-name" data-name>${s.name}</div>
          <div class="set-card-meta">${s.config.scales.length} ${s.config.scales.length === 1 ? 'scale' : 'scales'} · ${this._relTime(s.modified)}</div>
        `;

        const actions = document.createElement('div');
        actions.className = 'set-card-actions';

        const mkBtn = (ico, tip, handler, extra = '') => {
          const b = document.createElement('button');
          b.className = 'btn-icon set-card-btn' + (extra ? ' ' + extra : '');
          b.dataset.tooltip = tip;
          b.innerHTML = icon(ico, 14);
          b.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
          return b;
        };

        actions.appendChild(mkBtn('pencil', 'Rename', () => openRename(info, s)));

        actions.appendChild(mkBtn('copy', 'Duplicate', () => {
          this.store.duplicate(s.id);
          renderList();
        }));

        const delBtn = mkBtn('trash', 'Delete', () => {
          if (!confirm(`Delete "${s.name}"? This cannot be undone.`)) return;
          const wasActive = s.id === this.store.activeId;
          this.store.delete(s.id);
          if (wasActive) {
            this._loadConfigIntoManager(this.store.getActive().config);
            this.manager.selectedId = null;
            this._openSourcePanelId = null;
            this._render();
            this._scheduleGradientResize();
          }
          renderList();
        }, 'set-card-btn-danger');
        if (this.store.sets.length <= 1) delBtn.disabled = true;
        actions.appendChild(delBtn);

        card.appendChild(strip);
        card.appendChild(info);
        card.appendChild(actions);

        card.addEventListener('click', (e) => {
          if (e.target.closest('.set-card-actions') || e.target.closest('.set-rename-input')) return;
          if (s.id !== this.store.activeId) this._switchSet(s.id);
          overlay.remove();
        });

        list.appendChild(card);

        if (s.id === renameId) {
          card.scrollIntoView({ block: 'nearest' });
          openRename(info, s);
        }
      });
    };

    renderList();

    modal.querySelector('#btn-new-set').addEventListener('click', () => {
      const id = this.store.create('Untitled', defaultsConfig());
      this._switchSet(id);
      // Modal survives _render() (it lives on document.body, not this.root).
      // Re-render the list with the new card in rename mode.
      renderList(id);
    });
  }

  // ---- URL sharing ----

  // Compare curve point arrays with epsilon tolerance
  _curvesMatch(a, b, eps = 1e-4) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i].x - b[i].x) > eps || Math.abs(a[i].y - b[i].y) > eps) return false;
    }
    return true;
  }

  // Build compact share payload from current manager state.
  // Omits curve points that match _initCurves() output to keep URLs short.
  _buildSharePayload() {
    const mgr = this.manager;
    // Build a throwaway manager with matching limits so we can regenerate
    // default curves for comparison (they depend on lMax/lMin).
    const refMgr = new ScaleManager();
    refMgr.lightnessMax = mgr.lightnessMax;
    refMgr.lightnessMin = mgr.lightnessMin;

    const scales = mgr.scales.map(s => {
      const entry = {
        n: s.name,
        k: s.keyColors.map(h => h.replace(/^#/, ''))
      };
      // Default curves for these keys at these limits
      const ref = new Scale(s.name, s.keyColors, refMgr);
      if (!this._curvesMatch(s.curvePoints.C, ref.curvePoints.C)) {
        entry.c = s.curvePoints.C.map(p => [p.x, p.y]);
      }
      if (!this._curvesMatch(s.curvePoints.H, ref.curvePoints.H)) {
        entry.h = s.curvePoints.H.map(p => [p.x, p.y]);
      }
      return entry;
    });

    return {
      v: 1,
      name: this.store.getActive().name,
      lMax: mgr.lightnessMax,
      lMin: mgr.lightnessMin,
      scales
    };
  }

  // Convert compact payload → ScaleManager.fromConfig shape
  _payloadToConfig(payload) {
    return {
      lightnessMax: payload.lMax ?? 1.0,
      lightnessMin: payload.lMin ?? 0.15,
      scales: payload.scales.map(s => {
        const cfg = {
          name: s.n,
          keyColors: s.k.map(h => '#' + h)
        };
        if (s.c || s.h) {
          cfg.curvePoints = {};
          if (s.c) cfg.curvePoints.C = s.c.map(([x, y]) => ({ x, y }));
          if (s.h) cfg.curvePoints.H = s.h.map(([x, y]) => ({ x, y }));
        }
        return cfg;
      })
    };
  }

  async _showShareDialog() {
    document.querySelector('.modal-overlay')?.remove();

    // Flush pending edits so the share reflects current state
    this._saveActiveSet();

    // Encode (async — may take a few ms)
    const payload = this._buildSharePayload();
    const encoded = await encodeSet(payload);
    const fullUrl = location.href.split('#')[0] + '#s=' + encoded;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.className = 'modal share-dialog';
    modal.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">Share "${payload.name}"</h2>
        <button class="btn-icon btn-close-modal">${icon('x',16)}</button>
      </div>
      <div class="modal-body">
        <div class="share-section">
          <div class="share-label">Full URL</div>
          <div class="share-row">
            <input class="share-field" type="text" readonly value="${fullUrl}">
            <button class="btn btn-secondary btn-copy-share" data-copy="url">${icon('copy',14)} Copy</button>
          </div>
        </div>
        <div class="share-section">
          <div class="share-label">Parameters only</div>
          <div class="share-row">
            <input class="share-field" type="text" readonly value="${encoded}">
            <button class="btn btn-secondary btn-copy-share" data-copy="params">${icon('copy',14)} Copy</button>
          </div>
        </div>
        <div class="share-divider"></div>
        <div class="share-section">
          <div class="share-label">Import a set</div>
          <div class="share-row">
            <input class="share-field share-import-field" type="text" placeholder="Paste URL or parameters…">
            <button class="btn btn-primary" id="btn-import-share" disabled>Import</button>
          </div>
        </div>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector('.btn-close-modal').addEventListener('click', () => overlay.remove());

    // Copy buttons
    modal.querySelectorAll('.btn-copy-share').forEach(btn => {
      btn.addEventListener('click', async () => {
        const text = btn.dataset.copy === 'url' ? fullUrl : encoded;
        try {
          await navigator.clipboard.writeText(text);
          const orig = btn.innerHTML;
          btn.innerHTML = icon('check',14) + ' Copied';
          setTimeout(() => { btn.innerHTML = orig; }, 1200);
        } catch (e) {
          this._showToast('Copy failed', true);
        }
      });
    });

    // Import
    const importField = modal.querySelector('.share-import-field');
    const importBtn = modal.querySelector('#btn-import-share');
    importField.addEventListener('input', () => {
      importBtn.disabled = !importField.value.trim();
    });
    const doImport = async () => {
      let raw = importField.value.trim();
      if (!raw) return;
      // Strip any leading URL/#s= prefix — accept both forms
      const hashIdx = raw.indexOf('#s=');
      if (hashIdx !== -1) raw = raw.slice(hashIdx + 3);
      else if (raw.startsWith('s=')) raw = raw.slice(2);
      try {
        const imported = await decodeSet(raw);
        overlay.remove();
        this._showImportConfirmation(imported);
      } catch (e) {
        this._showToast('Invalid share data: ' + e.message, true);
      }
    };
    importBtn.addEventListener('click', doImport);
    importField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doImport(); }
    });
  }

  _showImportConfirmation(payload) {
    document.querySelector('.modal-overlay')?.remove();

    const scaleCount = payload.scales.length;
    const keyCount = payload.scales.reduce((n, s) => n + s.k.length, 0);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.className = 'modal import-confirm';
    modal.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">Import set</h2>
        <button class="btn-icon btn-close-modal">${icon('x',16)}</button>
      </div>
      <div class="modal-body">
        <div class="share-label">Name</div>
        <input class="share-field import-name-field" type="text" value="${payload.name || 'Imported'}">
        <p class="import-summary">${scaleCount} ${scaleCount === 1 ? 'scale' : 'scales'} · ${keyCount} key ${keyCount === 1 ? 'color' : 'colors'}</p>
        <div class="import-actions">
          <button class="btn btn-secondary" id="btn-import-cancel">Cancel</button>
          <button class="btn btn-primary" id="btn-import-confirm">Import</button>
        </div>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const nameField = modal.querySelector('.import-name-field');
    nameField.focus(); nameField.select();

    modal.querySelector('.btn-close-modal').addEventListener('click', () => overlay.remove());
    modal.querySelector('#btn-import-cancel').addEventListener('click', () => overlay.remove());

    modal.querySelector('#btn-import-confirm').addEventListener('click', () => {
      const name = nameField.value.trim() || payload.name || 'Imported';
      const config = this._payloadToConfig(payload);
      const id = this.store.create(name, config);
      this._switchSet(id);
      overlay.remove();
      this._showToast(`Imported "${this.store.getActive().name}"`);
    });

    nameField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        modal.querySelector('#btn-import-confirm').click();
      }
    });
  }

  _showToast(msg, isError) {
    // Remove any existing toast
    const old = document.querySelector('.toast-notification');
    if (old) old.remove();
    
    const toast = document.createElement('div');
    toast.className = 'toast-notification' + (isError ? ' toast-error' : '');
    toast.textContent = msg;
    document.body.appendChild(toast);
    
    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  _scheduleGradientResize() {
    // Single deferred sync after layout settles
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this._syncGradientHeights());
    });
    
    // Set up ResizeObserver for responsive gradient sizing
    this._observeGradientContainers();
  }
  
  _observeGradientContainers() {
    // Clean up previous observers
    if (this._resizeObserver) this._resizeObserver.disconnect();
    
    // Debounce with a timer to coalesce rapid resize events
    let syncTimer = null;
    const debouncedSync = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        this._syncSourcePanelGradients();
      }, 60);
    };
    
    this._resizeObserver = new ResizeObserver(debouncedSync);
    
    // Observe source panel containers if any are open
    document.querySelectorAll('.source-panel').forEach(sp => {
      this._resizeObserver.observe(sp);
    });
  }

  _syncSourcePanelGradients() {
    document.querySelectorAll('.source-panel').forEach(panel => {
      const gradCanvas = panel.querySelector('.gradient-strip');
      const middleRow = panel.querySelector('.source-panel-middle');
      if (!gradCanvas || !middleRow) return;
      const h = middleRow.clientHeight - 16; // subtract 8px top + 8px bottom margin
      if (h <= 0) return;
      const rounded = Math.round(h);
      if (gradCanvas._lastSyncHeight === rounded) return;
      gradCanvas._lastSyncHeight = rounded;
      const dpr = window.devicePixelRatio || 1;
      gradCanvas.style.blockSize = rounded + 'px';
      gradCanvas.height = Math.round(rounded * dpr);
      gradCanvas.width = 48 * dpr;
      const col = panel.closest('.scale-column');
      const idx = [...document.querySelectorAll('.scale-column')].indexOf(col);
      if (idx >= 0 && this.manager.scales[idx]) {
        this._drawGradientStrip(gradCanvas, this.manager.scales[idx]);
      }
    });
  }

  _syncGradientHeights() {
    // Legacy — now handled by _syncSourcePanelGradients
    this._syncSourcePanelGradients();
  }

  _render() {
    this.root.innerHTML = '';
    this._applyThemeFromScale();
    this._renderHeader();
    this._renderMain();
    this._renderCurvePanel();
    this._scheduleGradientResize();
    
    // Re-open source panel if one was open before render
    if (this._openSourcePanelId) {
      const scale = this.manager.scales.find(s => s.id === this._openSourcePanelId);
      if (scale) {
        const col = document.querySelector(`.scale-column[data-scale-id="${scale.id}"]`);
        if (col) {
          this._showSourcePopover(col, scale, col.querySelector('.scale-header'), true);
          // Focus the newly added color's hex input
          if (this._focusNewSourceInput) {
            const targetHex = this._focusNewSourceInput;
            this._focusNewSourceInput = null;
            requestAnimationFrame(() => {
              const inputs = col.querySelectorAll('.source-panel .hex-input');
              for (const inp of inputs) {
                if (inp.value === targetHex.toUpperCase()) {
                  inp.focus();
                  inp.select();
                  break;
                }
              }
            });
          }
        }
      }
    }
  }

  _scaleCssPrefix(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // Semantic token → step mapping (gap from bg at step 0)
  static get SEMANTIC_MAP() {
    return [
      ['--bg',              0],
      ['--bg-subtle',       20],
      ['--bg-muted',        60],
      ['--bg-alt',          50],
      ['--hover',           50],
      ['--border-subtle',   150],   // 150 gap
      ['--border',          200],   // 200 gap
      ['--border-strong',   300],   // 300 gap
      ['--border-hover',    400],   // 400 gap — 3:1
      ['--text-muted',      450],   // 450 gap
      ['--text-muted-strong', 550], // 550 gap
      ['--text-secondary',  600],   // 600 gap
      ['--text',            700],   // 700 gap
      ['--accent',          850],
      ['--accent-fg',       0],
      ['--accent-100',      100],
      ['--outline-active',  550],
    ];
  }

  _applyThemeFromScale() {
    const root = document.documentElement;

    // 1. Inject all scale primitives as CSS variables via <style> element
    let css = ':root {\n';
    for (const scale of this.manager.scales) {
      const prefix = this._scaleCssPrefix(scale.name);
      for (const s of scale.steps) {
        css += `  --${prefix}-${s.label}: ${s.hex};\n`;
      }
    }
    css += '}';

    let styleEl = document.getElementById('chromascale-vars');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'chromascale-vars';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;

    // 2. Wire semantic chrome tokens on :root to primary scale's primitives
    const primary = this.manager.scales[0];
    if (!primary) return;
    const p = this._scaleCssPrefix(primary.name);

    for (const [token, step] of App.SEMANTIC_MAP) {
      root.style.setProperty(token, `var(--${p}-${step})`);
    }

    // 3. Map semantic role colors from named scales
    const roles = [
      ['danger',   /^red$/i,                     450, 50, 800],
      ['warning',  /^(yellow|amber|orange)$/i,   300, 50, 800],
      ['success',  /^green$/i,                   400, 50, 800],
      ['positive', /^(aqua|teal|cyan|mint)$/i,   400, 50, 800],
      ['info',     /^(violet|purple|indigo)$/i,  500, 50, 800],
      ['adjusted', /^blue$/i,                    400, 50, 800],
    ];

    const matched = new Set();
    for (const scale of this.manager.scales) {
      const name = scale.name.trim();
      for (const [role, pattern, mainStep, subtleStep, fgStep] of roles) {
        if (!matched.has(role) && pattern.test(name)) {
          const sp = this._scaleCssPrefix(name);
          root.style.setProperty(`--${role}`,         `var(--${sp}-${mainStep})`);
          root.style.setProperty(`--${role}-subtle`,  `var(--${sp}-${subtleStep})`);
          root.style.setProperty(`--${role}-fg`,      `var(--${sp}-${fgStep})`);
          matched.add(role);
        }
      }
    }
  }

  _renderHeader() {
    const header = document.createElement('header');
    header.className = 'app-header';
    header.innerHTML = `
      <div class="header-left">
        <h1 class="app-title">ChromaScale</h1>
        <div class="set-switcher-wrap">
          <button class="set-switcher" id="btn-set-switcher">
            <span class="set-switcher-name">${this.store.getActive().name}</span>
            ${icon('caret-down',12)}
          </button>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-secondary" id="btn-add-scale">
          ${icon('plus',14)}
          Add scale
        </button>
        <div class="settings-wrap">
          <button class="btn btn-secondary btn-icon-only" id="btn-settings" data-tooltip="Global settings">
            ${icon('gear',16)}
          </button>
        </div>
        <button class="btn btn-secondary btn-icon-only" id="btn-share" data-tooltip="Share">
          ${icon('share',16)}
        </button>
        <button class="btn btn-primary" id="btn-export">
          ${icon('export',16)}
          Export
        </button>
      </div>
    `;
    this.root.appendChild(header);

    header.querySelector('#btn-add-scale').addEventListener('click', () => {

      const colors = ['#8B5CF6', '#D97757', '#06B6D4', '#EC4899', '#84CC16', '#F59E0B'];
      const names = ['Custom', 'Clay', 'Teal', 'Pink', 'Lime', 'Amber'];
      const idx = this.manager.scales.length % colors.length;
      this.manager.addScale(names[idx] || 'New', colors[idx] || '#8B5CF6');
      this._saveActiveSet();
      this._render();
    });
    
    header.querySelector('#btn-settings').addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleSettingsPopover(header.querySelector('.settings-wrap'));
    });
    header.querySelector('#btn-export').addEventListener('click', () => this._showExportModal());
    header.querySelector('#btn-share').addEventListener('click', () => this._showShareDialog());
    header.querySelector('#btn-set-switcher').addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleSetDropdown(header.querySelector('.set-switcher-wrap'));
    });
  }

  _toggleSettingsPopover(anchor) {
    const existing = anchor.querySelector('.settings-popover');
    if (existing) { existing.remove(); return; }
    
    // Close any other popovers
    document.querySelectorAll('.settings-popover').forEach(p => p.remove());
    
    // Read current values from manager (global limits)
    const whiteLimit = this.manager.lightnessMax;
    const blackLimit = this.manager.lightnessMin;
    
    // Check all step pairs against contrast requirements using the linear L schedule
    const rangeWarning = (lMax, lMin) => {
      // Build linear L schedule for all steps
      const Ls = STEP_LABELS.map(s => lMax - (lMax - lMin) * (s / 900));
      // Find the worst failing pair (largest deficit = req - actual)
      let worstDeficit = 0, worstRatio = 0, worstReq = 0, worstFrom = 0, worstTo = 0;
      for (let i = 0; i < STEP_LABELS.length; i++) {
        for (let j = i + 1; j < STEP_LABELS.length; j++) {
          const gap = STEP_LABELS[j] - STEP_LABELS[i];
          const req = gap >= 600 ? 7 : gap >= 500 ? 4.5 : gap >= 400 ? 3 : 0;
          if (!req) continue;
          const yI = Ls[i] * Ls[i] * Ls[i];
          const yJ = Ls[j] * Ls[j] * Ls[j];
          const ratio = (yI + 0.05) / (yJ + 0.05);
          const deficit = req - ratio;
          if (deficit > worstDeficit) {
            worstDeficit = deficit;
            worstRatio = ratio;
            worstReq = req;
            worstFrom = STEP_LABELS[i];
            worstTo = STEP_LABELS[j];
          }
        }
      }
      if (worstDeficit <= 0) return '';
      const level = worstReq >= 7 ? 'AAA (7:1)' : worstReq >= 4.5 ? 'AA (4.5:1)' : 'A (3:1)';
      return `Steps ${worstFrom}\u2013${worstTo} only achieve ${worstRatio.toFixed(1)}:1 (needs ${worstReq}:1 for ${level}). Widen the lightness range.`;
    };

    const popover = document.createElement('div');
    popover.className = 'settings-popover';
    popover.innerHTML = `
      <div class="settings-section">
        <div class="settings-popover-header">Lightness</div>
        <div class="settings-popover-body">
          <div class="settings-row">
            <label class="settings-label">Lightest point <span class="settings-hint">(step 0)</span></label>
            <input type="number" class="control-input" id="settings-white-limit"
              value="${whiteLimit.toFixed(2)}" min="0.5" max="1" step="0.01">
          </div>
          <div class="settings-row">
            <label class="settings-label">Darkest point <span class="settings-hint">(step 900)</span></label>
            <input type="number" class="control-input" id="settings-black-limit"
              value="${blackLimit.toFixed(2)}" min="0" max="0.5" step="0.01">
          </div>
          <div class="settings-warning" id="settings-light-warning"></div>
        </div>
      </div>
    `;
    anchor.appendChild(popover);

    const lightWarningEl = popover.querySelector('#settings-light-warning');

    const updateWarnings = () => {
      const lw = rangeWarning(this.manager.lightnessMax, this.manager.lightnessMin);
      lightWarningEl.textContent = lw;
      lightWarningEl.hidden = !lw;
    };
    updateWarnings();

    // Bind input handlers — use 'input' for real-time updates (spinner, arrows, typing)
    // Full _render() + re-open popover ensures all steps (including endpoints) update
    const onLimitChange = (setter, inputId) => {
      return (e) => {
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        setter.call(this.manager, val);
        const selected = this.manager.getSelected();
        if (selected && this.curveEditor) {
          this._setCurveEditorLReference();
          this._updateConstraintBounds(selected);
        }
        this._saveActiveSet();
        this._render();
        // Re-open settings popover and restore focus to the active input
        const newAnchor = this.root.querySelector('.settings-wrap');
        if (newAnchor) {
          this._toggleSettingsPopover(newAnchor);
          const inp = newAnchor.querySelector('#' + inputId);
          if (inp) { inp.focus(); inp.select(); }
        }
      };
    };

    popover.querySelector('#settings-white-limit').addEventListener('input',
      onLimitChange(this.manager.setLightnessMax, 'settings-white-limit'));
    popover.querySelector('#settings-black-limit').addEventListener('input',
      onLimitChange(this.manager.setLightnessMin, 'settings-black-limit'));
    
    // Close when clicking outside
    const closeOnOutside = (e) => {
      if (!popover.contains(e.target) && !anchor.contains(e.target)) {
        popover.remove();
        document.removeEventListener('mousedown', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 10);
  }

  // Lightweight update: refresh swatch colors + CSS vars without rebuilding DOM
  _refreshSwatches() {
    for (const scale of this.manager.scales) {
      const col = this.root.querySelector(`.scale-column[data-scale-id="${scale.id}"]`);
      if (!col) continue;
      const steps = scale.steps;
      const prefix = this._scaleCssPrefix(scale.name);
      const rows = col.querySelectorAll('.swatch-row');
      rows.forEach((row, i) => {
        if (i >= steps.length) return;
        const step = steps[i];
        row.style.backgroundColor = step.hex;
        row.dataset.hex = step.hex;
        // Update per-row dynamic colors
        const dir = step.label < 500 ? 1 : -1;
        const snap = (t) => {
          const clamped = Math.max(0, Math.min(900, t));
          if (dir > 0) return STEP_LABELS.find(s => s >= clamped) || 900;
          return STEP_LABELS.findLast(s => s <= clamped) || 0;
        };
        row.style.setProperty('--swatch-text', `var(--${prefix}-${snap(step.label + 450 * dir)})`);
        row.style.setProperty('--swatch-text-hover', `var(--${prefix}-${snap(step.label + 600 * dir)})`);
        row.style.setProperty('--swatch-bg-hover', `var(--${prefix}-${snap(step.label + 150 * dir)})`);
        // Update overlay text
        const hexEl = row.querySelector('.hex-value');
        if (hexEl) hexEl.textContent = step.hex.toUpperCase();
        const oklchEl = row.querySelector('.swatch-oklch');
        if (oklchEl) oklchEl.textContent = `L${step.oklch.L.toFixed(2)} C${step.oklch.C.toFixed(3)} H${step.oklch.H.toFixed(0)}`;
      });
    }
    this._applyThemeFromScale();
  }

  _renderMain() {
    const wrapper = document.createElement('div');
    wrapper.className = 'scales-wrapper';

    const main = document.createElement('div');
    main.className = 'scales-container';

    this.manager.scales.forEach(scale => {
      const col = this._createScaleColumn(scale);
      main.appendChild(col);
    });

    wrapper.appendChild(main);

    // Scroll arrow buttons
    const leftArrow = document.createElement('button');
    leftArrow.className = 'scroll-arrow scroll-arrow-left';
    leftArrow.hidden = true;
    leftArrow.innerHTML = icon('caret-left', 20);
    wrapper.appendChild(leftArrow);

    const rightArrow = document.createElement('button');
    rightArrow.className = 'scroll-arrow scroll-arrow-right';
    rightArrow.hidden = true;
    rightArrow.innerHTML = icon('caret-right', 20);
    wrapper.appendChild(rightArrow);

    this.root.appendChild(wrapper);
    this._initScrollArrows();
  }

  _initScrollArrows() {
    const wrapper = this.root.querySelector('.scales-wrapper');
    if (!wrapper) return;
    const scroller = wrapper.querySelector('.scales-container');
    const leftBtn = wrapper.querySelector('.scroll-arrow-left');
    const rightBtn = wrapper.querySelector('.scroll-arrow-right');

    // Insert sentinel elements at the edges
    const startSentinel = document.createElement('div');
    startSentinel.className = 'scroll-sentinel';
    const endSentinel = document.createElement('div');
    endSentinel.className = 'scroll-sentinel';
    scroller.prepend(startSentinel);
    scroller.append(endSentinel);

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === startSentinel) {
          leftBtn.hidden = entry.isIntersecting;
        }
        if (entry.target === endSentinel) {
          rightBtn.hidden = entry.isIntersecting;
        }
      }
    }, { root: scroller, threshold: 0 });

    observer.observe(startSentinel);
    observer.observe(endSentinel);

    const scrollAmount = () => {
      const col = scroller.querySelector('.scale-column');
      return col ? col.offsetWidth + 16 : 300;
    };
    leftBtn.addEventListener('click', () => {
      scroller.scrollBy({ left: -scrollAmount(), behavior: 'smooth' });
    });
    rightBtn.addEventListener('click', () => {
      scroller.scrollBy({ left: scrollAmount(), behavior: 'smooth' });
    });
  }

  _createScaleColumn(scale) {
    const col = document.createElement('div');
    col.className = 'scale-column' + (scale.id === this.manager.selectedId ? ' selected' : '');
    col.dataset.scaleId = scale.id;

    // Per-column semantic overrides — scope all children to this scale's palette
    const prefix = this._scaleCssPrefix(scale.name);
    for (const [token, step] of App.SEMANTIC_MAP) {
      col.style.setProperty(token, `var(--${prefix}-${step})`);
    }

    const allSteps = scale.steps;

    // Scale header
    const header = document.createElement('div');
    header.className = 'scale-header';

    const bar = document.createElement('div');
    bar.className = 'scale-header-bar';
    // Background and text color come from CSS via column-scoped semantic tokens

    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle';
    dragHandle.setAttribute('data-tooltip', 'Drag to reorder');
    dragHandle.innerHTML = icon('dots-six-vertical',14);
    bar.appendChild(dragHandle);

    // Pointer-based drag to reorder
    this._initColumnDrag(dragHandle, col, scale);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'scale-name-input';
    nameInput.value = scale.name;
    nameInput.addEventListener('change', (e) => {
      scale.name = e.target.value;
      const panelName = document.querySelector('.curve-scale-name');
      if (panelName) panelName.textContent = scale.name;
      this._saveActiveSet();
      // Re-render to update CSS variable prefixes for the renamed scale
      this._render();
    });
    bar.appendChild(nameInput);

    const validation = scale.getContrastValidation();
    const failCount = validation.constrained.filter(v => !v.pass).length;
    const adjustCount = allSteps.filter(s => s.adjusted).length;

    // More menu (three dots)
    const moreWrap = document.createElement('div');
    moreWrap.className = 'scale-more-wrap';

    const moreBtn = document.createElement('button');
    moreBtn.className = 'btn-icon btn-more';
    moreBtn.setAttribute('data-tooltip', 'Scale options');
    moreBtn.innerHTML = icon('dots-three',16);
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = moreWrap.querySelector('.scale-dropdown');
      if (existing) { existing.remove(); moreBtn.classList.remove('active'); return; }
      document.querySelectorAll('.scale-dropdown').forEach(d => d.remove());
      document.querySelectorAll('.btn-more.active').forEach(b => b.classList.remove('active'));
      moreBtn.classList.add('active');
      this._showScaleDropdown(moreWrap, col, scale);
    });
    moreWrap.appendChild(moreBtn);
    bar.appendChild(moreWrap);

    header.appendChild(bar);
    col.appendChild(header);

    // Swatch area
    const swatchArea = document.createElement('div');
    swatchArea.className = 'swatch-area';

    // Swatch list — color blocks
    const swatchList = document.createElement('div');
    swatchList.className = 'swatch-list';

    const stepsToRender = allSteps;

    stepsToRender.forEach((step) => {
      const isMinor = !step.isMajor;

      const row = document.createElement('div');
      row.className = 'swatch-row' + (isMinor ? ' minor' : '');
      row.dataset.label = step.label;
      row.dataset.hex = step.hex;
      row.style.backgroundColor = step.hex;

      // Gamut/adjusted dots positioned within the row
      if (step.clamped) {
        const warn = document.createElement('span');
        warn.className = 'gamut-dot';
        warn.setAttribute('data-tooltip', 'Gamut-clamped');
        row.appendChild(warn);
      }
      if (step.adjusted) {
        const adj = document.createElement('span');
        adj.className = 'adjusted-dot';
        adj.setAttribute('data-tooltip', `L adjusted: ${step.desiredL.toFixed(3)} → ${step.effectiveL.toFixed(3)}`);
        row.appendChild(adj);
      }

      // Per-row colors — offset from this swatch's step
      const dir = step.label < 500 ? 1 : -1;
      const snap = (t) => {
        const clamped = Math.max(0, Math.min(900, t));
        if (dir > 0) return STEP_LABELS.find(s => s >= clamped) || 900;
        return STEP_LABELS.findLast(s => s <= clamped) || 0;
      };
      const textStep = snap(step.label + 450 * dir);
      const textHoverStep = snap(step.label + 600 * dir);
      const bgHoverStep = snap(step.label + 150 * dir);
      row.style.setProperty('--swatch-text', `var(--${prefix}-${textStep})`);
      row.style.setProperty('--swatch-text-hover', `var(--${prefix}-${textHoverStep})`);
      row.style.setProperty('--swatch-bg-hover', `var(--${prefix}-${bgHoverStep})`);

      // Overlay — visible on hover
      const overlay = document.createElement('div');
      overlay.className = 'swatch-overlay';

      const swatchInfo = document.createElement('div');
      swatchInfo.className = 'swatch-info';

      const labelLine = document.createElement('div');
      labelLine.className = 'swatch-label-hex';
      labelLine.innerHTML = `<span class="step-label">${step.label}</span><span class="swatch-oklch">L${step.oklch.L.toFixed(2)} C${step.oklch.C.toFixed(3)} H${step.oklch.H.toFixed(0)}</span>`;
      swatchInfo.appendChild(labelLine);

      // Action buttons
      const actions = document.createElement('div');
      actions.className = 'swatch-actions';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'swatch-action-btn';
      copyBtn.setAttribute('data-tooltip', 'Copy hex');
      copyBtn.innerHTML = icon('copy',14);
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(step.hex.toUpperCase()).then(() => {
          copyBtn.innerHTML = icon('check',14);
          setTimeout(() => {
            copyBtn.innerHTML = icon('copy',14);
          }, 1200);
        });
      });
      actions.appendChild(copyBtn);

      const graphBtn = document.createElement('button');
      graphBtn.className = 'swatch-action-btn';
      graphBtn.setAttribute('data-tooltip', 'Open curve editor');
      graphBtn.innerHTML = icon('chart-line',14);
      graphBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.manager.select(scale.id);
        this._updateSelection();
        this._renderCurvePanel();
        if (this.curveEditor) {
          this.curveEditor.setHighlightT(step.t);
        }
      });
      actions.appendChild(graphBtn);

      overlay.appendChild(swatchInfo);
      overlay.appendChild(actions);
      row.appendChild(overlay);
      swatchList.appendChild(row);
    });

    swatchArea.appendChild(swatchList);
    
    // Contrast hover interaction
    this._attachContrastHover(col, swatchList, scale);
    
    col.appendChild(swatchArea);

    return col;
  }

  _showScaleDropdown(anchorEl, col, scale) {
    const dropdown = document.createElement('div');
    dropdown.className = 'scale-dropdown';

    const isCurveOpen = this.manager.selectedId === scale.id;
    const isSourceOpen = !!col.querySelector('.source-panel:not(.closing)');
    const items = [
      {
        label: isSourceOpen ? 'Close source colors' : 'Source colors',
        icon: icon('palette',16),
        action: () => {
          dropdown.remove();
          // Re-check at action time since state may have changed
          const existing = col.querySelector('.source-panel:not(.closing)');
          if (existing) { this._closeSourcePanel(existing); return; }
          document.querySelectorAll('.source-panel').forEach(p => this._closeSourcePanel(p));
          this._showSourcePopover(col, scale, col.querySelector('.scale-header'));
        }
      },
      {
        label: isCurveOpen ? 'Close curve editor' : 'Curve editor',
        icon: icon('chart-line',16),
        action: () => {
          dropdown.remove();
          if (isCurveOpen) {
            this._closeCurvePanel();
          } else {
            this.manager.select(scale.id);
            this._updateSelection();
            this._renderCurvePanel();
          }
        }
      },
      { type: 'divider' },
      {
        label: 'Duplicate scale',
        icon: icon('copy',16),
        action: () => {
          dropdown.remove();
    
          const prevSelected = this.manager.selectedId;
          this.manager.duplicateScale(scale.id);
          // Don't open curve editor for the new scale
          this.manager.selectedId = prevSelected;
          this._saveActiveSet();
          this._render();
          this._scheduleGradientResize();
        }
      },
      {
        label: 'Delete scale',
        icon: icon('trash',16),
        className: 'dropdown-item-danger',
        disabled: this.manager.scales.length <= 1,
        action: () => {
          dropdown.remove();
    
          this.manager.removeScale(scale.id);
          this._saveActiveSet();
          this._render();
          this._scheduleGradientResize();
        }
      }
    ];

    items.forEach(item => {
      if (item.type === 'divider') {
        const divider = document.createElement('div');
        divider.className = 'dropdown-divider';
        dropdown.appendChild(divider);
        return;
      }
      const btn = document.createElement('button');
      btn.className = 'dropdown-item' + (item.className ? ' ' + item.className : '');
      if (item.disabled) btn.disabled = true;
      btn.innerHTML = `<span class="dropdown-item-icon">${item.icon}</span><span class="dropdown-item-label">${item.label}</span>`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Remove active state from more button when item is clicked
        const moreBtn = anchorEl.querySelector('.btn-more');
        if (moreBtn) moreBtn.classList.remove('active');
        item.action();
      });
      dropdown.appendChild(btn);
    });

    anchorEl.appendChild(dropdown);

    // Close when clicking outside
    const closeOnOutside = (e) => {
      if (!dropdown.contains(e.target) && !anchorEl.contains(e.target)) {
        dropdown.remove();
        // Remove active state from the more button
        const moreBtn = anchorEl.querySelector('.btn-more');
        if (moreBtn) moreBtn.classList.remove('active');
        document.removeEventListener('mousedown', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 10);
  }

  _closeSourcePanel(panel) {
    if (panel._closing) return;
    panel._closing = true;
    this._openSourcePanelId = null;
    // Remove dimming and active highlight from columns
    document.querySelectorAll('.scale-column.dimmed').forEach(c => c.classList.remove('dimmed'));
    document.querySelectorAll('.scale-column.source-active').forEach(c => c.classList.remove('source-active'));
    // Clear any inline animation override (e.g. from skipAnimation) so close animation plays
    panel.style.animation = '';
    panel.classList.add('closing');
    panel.addEventListener('animationend', () => panel.remove(), { once: true });
  }

  _showSourcePopover(col, scale, anchorEl, skipAnimation) {
    // Find the swatch area to overlay
    const swatchArea = col.querySelector('.swatch-area');
    if (!swatchArea) return;
    
    this._openSourcePanelId = scale.id;
    
    // Dim all other scale columns, highlight the active one
    document.querySelectorAll('.scale-column').forEach(c => {
      c.classList.toggle('dimmed', c !== col);
      c.classList.toggle('source-active', c === col);
    });
    
    const panel = document.createElement('div');
    panel.className = 'source-panel';
    if (skipAnimation) panel.style.animation = 'none';
    
    // Gradient strip (moved from main view)
    const dpr = window.devicePixelRatio || 1;
    
    // Content area (header + gradient + color list + footer)
    const content = document.createElement('div');
    content.className = 'source-panel-content';
    
    // Gradient strip inside content
    const gradCanvas = document.createElement('canvas');
    gradCanvas.className = 'gradient-strip source-panel-gradient';
    gradCanvas.width = 48 * dpr;
    gradCanvas.height = 100 * dpr;
    gradCanvas.style.inlineSize = '48px';
    
    // Header
    const panelHeader = document.createElement('div');
    panelHeader.className = 'source-panel-header';
    panelHeader.innerHTML = `<span class="source-panel-title">Source colors · ${scale.keyColors.length}</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-icon';
    closeBtn.setAttribute('data-tooltip', 'Close');
    closeBtn.innerHTML = icon('x',14);
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._closeSourcePanel(panel);
    });
    panelHeader.appendChild(closeBtn);
    content.appendChild(panelHeader);
    
    // Add color button (under header)
    const footer = document.createElement('div');
    footer.className = 'source-panel-footer';
    const addColorBtn = document.createElement('button');
    addColorBtn.className = 'btn btn-secondary btn-add-color';
    addColorBtn.innerHTML = icon('plus',14) + ' Add color';
    addColorBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      scale.addKeyColor('#ffffff');
      this._focusNewSourceInput = '#ffffff';
      this._saveActiveSet();
      this._render();
    });
    footer.appendChild(addColorBtn);
    content.appendChild(footer);
    
    // Middle area: gradient strip (left) + color list (right)
    const middleRow = document.createElement('div');
    middleRow.className = 'source-panel-middle';
    middleRow.appendChild(gradCanvas);
    
    // Color inputs list
    const colorsList = document.createElement('div');
    colorsList.className = 'source-panel-list';
    
    scale.keyColors.forEach((hex, idx) => {
      const isOutOfRange = scale.outOfRangeIndices.includes(idx);
      const row = document.createElement('div');
      row.className = 'color-input-row' + (isOutOfRange ? ' out-of-range' : '');
      
      const swatch = document.createElement('div');
      swatch.className = 'color-swatch-input';
      swatch.style.backgroundColor = hex;
      if (isOutOfRange) swatch.style.opacity = '0.4';
      
      const nativeInput = document.createElement('input');
      nativeInput.type = 'color';
      nativeInput.className = 'native-color-picker';
      nativeInput.value = hex;
      nativeInput.addEventListener('input', (e) => {
        if (!this._colorPickerUndoPushed) {
    
          this._colorPickerUndoPushed = true;
        }
        scale.updateKeyColor(idx, e.target.value);
        this._render();
      });
      nativeInput.addEventListener('change', () => {
        this._colorPickerUndoPushed = false;
        this._saveActiveSet();
      });
      swatch.appendChild(nativeInput);
      
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.className = 'hex-input';
      textInput.value = hex.toUpperCase();
      textInput.maxLength = 7;
      if (isOutOfRange) textInput.style.opacity = '0.4';
      textInput.addEventListener('change', (e) => {
        let val = e.target.value.trim();
        if (!val.startsWith('#')) val = '#' + val;
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
    
          scale.updateKeyColor(idx, val.toLowerCase());
          this._saveActiveSet();
          this._render();
        }
      });
      
      row.appendChild(swatch);
      row.appendChild(textInput);
      
      if (scale.keyColors.length > 1) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-icon btn-remove-color';
        removeBtn.innerHTML = icon('minus',12);
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
    
          scale.removeKeyColor(idx);
          this._saveActiveSet();
          this._render();
        });
        row.appendChild(removeBtn);
      }
      
      colorsList.appendChild(row);
    });
    
    middleRow.appendChild(colorsList);
    content.appendChild(middleRow);
    
    // Out-of-range note
    if (scale.outOfRangeCount > 0) {
      const note = document.createElement('div');
      note.className = 'out-of-range-note';
      note.textContent = `${scale.outOfRangeCount} input${scale.outOfRangeCount > 1 ? 's' : ''} beyond 900 range`;
      content.appendChild(note);
    }
    
    panel.appendChild(content);
    swatchArea.appendChild(panel);
    
    // Size and draw the gradient to fill the middle row height
    requestAnimationFrame(() => {
      const h = middleRow.clientHeight - 16; // subtract 8px top + 8px bottom margin
      if (h > 0) {
        gradCanvas.style.blockSize = h + 'px';
        gradCanvas.height = Math.round(h * dpr);
        gradCanvas.width = 48 * dpr;
        this._drawGradientStrip(gradCanvas, scale);
      }
      // Observe for resize
      this._observeGradientContainers();
    });
    
    // Close when clicking outside (only if panel is still in the DOM)
    const closeOnOutside = (e) => {
      if (!panel.isConnected) {
        document.removeEventListener('mousedown', closeOnOutside);
        return;
      }
      // Don't close if clicking inside the panel, the source button, 
      // the scale dropdown, the more button, or the curve panel
      const clickedInPanel = panel.contains(e.target);
      const clickedInAnchor = anchorEl.contains(e.target);
      const clickedInDropdown = e.target.closest('.scale-dropdown') || e.target.closest('.scale-more-wrap');
      const clickedInCurvePanel = e.target.closest('.curve-panel');
      if (!clickedInPanel && !clickedInAnchor && !clickedInDropdown && !clickedInCurvePanel) {
        this._closeSourcePanel(panel);
        document.removeEventListener('mousedown', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 10);
  }

  _initColumnDrag(handle, col, scale) {
    let isDragging = false;
    let startX = 0;
    let dragScaleId = null;
    let indicator = null;

    const getOrCreateIndicator = () => {
      if (indicator) return indicator;
      const wrapper = this.root.querySelector('.scales-wrapper');
      if (!wrapper) return null;
      indicator = document.createElement('div');
      indicator.className = 'drag-indicator';
      indicator.innerHTML = `<div class="drag-indicator-icon">${icon('plus',12)}</div><div class="drag-indicator-line"></div>`;
      wrapper.appendChild(indicator);
      return indicator;
    };

    const positionIndicator = (x, nearCol) => {
      const ind = getOrCreateIndicator();
      if (!ind) return;
      const wrapper = this.root.querySelector('.scales-wrapper');
      const wrapperRect = wrapper.getBoundingClientRect();
      ind.style.insetInlineStart = (x - wrapperRect.left - 1) + 'px';

      // Position icon at vertical center of the header bar
      const bar = nearCol.querySelector('.scale-header-bar');
      const swatchArea = nearCol.querySelector('.swatch-area');
      const iconEl = ind.querySelector('.drag-indicator-icon');
      const lineEl = ind.querySelector('.drag-indicator-line');
      if (bar) {
        const barRect = bar.getBoundingClientRect();
        const barMidY = barRect.top + barRect.height / 2 - wrapperRect.top;
        iconEl.style.insetBlockStart = barMidY + 'px';
      }
      if (swatchArea) {
        const saRect = swatchArea.getBoundingClientRect();
        lineEl.style.insetBlockStart = (saRect.top - wrapperRect.top) + 'px';
        lineEl.style.insetBlockEnd = (wrapperRect.bottom - saRect.bottom) + 'px';
      }

      ind.style.blockSize = wrapperRect.height + 'px';
      ind.classList.add('visible');
    };

    const hideIndicator = () => {
      if (indicator) {
        indicator.classList.remove('visible');
      }
    };

    const removeIndicator = () => {
      if (indicator) {
        indicator.remove();
        indicator = null;
      }
    };

    const onPointerDown = (e) => {
      e.preventDefault();
      isDragging = true;
      startX = e.clientX;
      dragScaleId = scale.id;
      col.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      // Find the gap to show the indicator in
      const allCols = [...document.querySelectorAll('.scale-column')];
      let bestGapX = null;
      let nearCol = null;

      for (let i = 0; i < allCols.length; i++) {
        const c = allCols[i];
        if (c === col) continue;
        const rect = c.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          nearCol = c;
          const midX = rect.left + rect.width / 2;
          if (e.clientX < midX) {
            bestGapX = rect.left - 8;
          } else {
            bestGapX = rect.right + 8;
          }
          break;
        }
      }

      if (bestGapX !== null && nearCol) {
        positionIndicator(bestGapX, nearCol);
      } else {
        hideIndicator();
      }
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      col.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      removeIndicator();

      // Find which column we're over
      const allCols = [...document.querySelectorAll('.scale-column')];
      let targetCol = null;
      let insertAfter = false;

      allCols.forEach(c => {
        if (c === col) return;
        const rect = c.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          targetCol = c;
          insertAfter = e.clientX >= rect.left + rect.width / 2;
        }
      });
      
      if (!targetCol) return;
      
      const targetId = targetCol.dataset.scaleId;
      let targetIndex = this.manager.scales.findIndex(s => s.id === targetId);
      if (insertAfter) targetIndex++;
      
      const draggedIndex = this.manager.scales.findIndex(s => s.id === dragScaleId);
      if (draggedIndex < targetIndex) targetIndex--;
      
      if (draggedIndex !== targetIndex) {
  
        this.manager.moveScale(dragScaleId, targetIndex);
        this._saveActiveSet();
        this._render();
      }
    };
    
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
  }

  _attachContrastHover(col, swatchList, scale) {
    const rows = swatchList.querySelectorAll('.swatch-row');

    const clearHighlights = () => {
      col.classList.remove('contrast-hover');
      rows.forEach(r => {
        r.classList.remove('hover-source', 'contrast-a', 'contrast-aa', 'contrast-aaa', 'contrast-none');
        r.style.removeProperty('--hover-outline');
        const badge = r.querySelector('.contrast-ratio-badge');
        if (badge) badge.remove();
      });
      col.querySelectorAll('.contrast-zone-pill').forEach(p => p.remove());
    };

    rows.forEach(sourceRow => {
      sourceRow.addEventListener('mouseenter', () => {
        clearHighlights();

        const sourceLabel = parseInt(sourceRow.dataset.label);
        const sourceHex = sourceRow.dataset.hex;

        col.classList.add('contrast-hover');
        sourceRow.classList.add('hover-source');

        // Outline color: +200 steps, snapped to nearest available step at or above
        const prefix = this._scaleCssPrefix(scale.name);
        const target = Math.min(sourceLabel + 200, 900);
        const outlineStep = STEP_LABELS.find(s => s >= target) || 900;
        sourceRow.style.setProperty('--hover-outline', `var(--${prefix}-${outlineStep})`);

        // Track rows per tier for pill creation
        const tierRows = { a: [], aa: [], aaa: [] };

        rows.forEach(targetRow => {
          if (targetRow === sourceRow) return;

          const targetLabel = parseInt(targetRow.dataset.label);
          const targetHex = targetRow.dataset.hex;
          const gap = Math.abs(targetLabel - sourceLabel);
          const signedGap = targetLabel - sourceLabel;
          const ratio = this._computeContrastFromHex(sourceHex, targetHex);

          let tierClass;
          if (gap >= 600) {
            tierClass = 'contrast-aaa';
            tierRows.aaa.push(targetRow);
          } else if (gap >= 500) {
            tierClass = 'contrast-aa';
            tierRows.aa.push(targetRow);
          } else if (gap >= 400) {
            tierClass = 'contrast-a';
            tierRows.a.push(targetRow);
          } else {
            tierClass = 'contrast-none';
          }

          targetRow.classList.add(tierClass);
          const badge = document.createElement('span');
          badge.className = 'contrast-ratio-badge';
          badge.textContent = `${signedGap > 0 ? '+' : ''}${signedGap} \u00B7 ${ratio.toFixed(1)}:1`;
          // Badge colors relative to the target swatch: 700 jump for text, 200 jump for bg
          const dir = targetLabel < 500 ? 1 : -1;
          const snapStep = (t) => {
            const c = Math.max(0, Math.min(900, t));
            if (dir > 0) return STEP_LABELS.find(s => s >= c) || 900;
            return STEP_LABELS.findLast(s => s <= c) || 0;
          };
          badge.style.color = `var(--${prefix}-${snapStep(targetLabel + 700 * dir)})`;
          badge.style.backgroundColor = `var(--${prefix}-${snapStep(targetLabel + 100 * dir)})`;
          targetRow.appendChild(badge);
        });

        // Create vertical pills for each tier, splitting non-contiguous groups
        const rowIndexMap = new Map();
        rows.forEach((r, i) => rowIndexMap.set(r, i));

        // Pills are appended to the column (not swatch-list) to avoid overflow clipping
        const swatchArea = col.querySelector('.swatch-area');
        const areaRect = swatchArea.getBoundingClientRect();
        const colRect = col.getBoundingClientRect();
        const areaOffsetTop = areaRect.top - colRect.top;
        const scrollTop = swatchArea.scrollTop;

        // Source row position relative to column (for pill text alignment)
        const sourceTop = sourceRow.offsetTop - scrollTop + areaOffsetTop;
        const sourceBottom = sourceTop + sourceRow.offsetHeight;

        const addPills = (tRows, tierLabel, ratioLabel, cls) => {
          if (tRows.length === 0) return;
          // Split into contiguous groups (adjacent in the DOM)
          const groups = [[tRows[0]]];
          for (let i = 1; i < tRows.length; i++) {
            const prevIdx = rowIndexMap.get(tRows[i - 1]);
            const currIdx = rowIndexMap.get(tRows[i]);
            if (currIdx - prevIdx > 1) {
              groups.push([tRows[i]]);
            } else {
              groups[groups.length - 1].push(tRows[i]);
            }
          }
          for (const group of groups) {
            const first = group[0];
            const last = group[group.length - 1];
            // Position relative to the column, accounting for swatch area offset and scroll
            const top = first.offsetTop - scrollTop + areaOffsetTop;
            const bottom = last.offsetTop + last.offsetHeight - scrollTop + areaOffsetTop;
            // Clip to swatch area visible bounds
            const visibleTop = Math.max(top, areaOffsetTop);
            const visibleBottom = Math.min(bottom, areaOffsetTop + swatchArea.clientHeight);
            if (visibleBottom <= visibleTop) return; // fully scrolled out
            const pill = document.createElement('div');
            pill.className = 'contrast-zone-pill ' + cls;
            pill.style.top = visibleTop + 'px';
            pill.style.height = (visibleBottom - visibleTop) + 'px';
            // Align text to the edge closest to the hover source
            // vertical writing-mode: justify-content = inline (vertical) axis
            // After 180deg rotation: flex-end = visual top, flex-start = visual bottom
            const isBelow = top >= sourceBottom;
            pill.style.justifyContent = isBelow ? 'flex-end' : 'flex-start';
            const tierSpan = document.createElement('span');
            tierSpan.className = 'pill-tier';
            tierSpan.textContent = tierLabel;
            const ratioSpan = document.createElement('span');
            ratioSpan.className = 'pill-ratio';
            ratioSpan.textContent = '\u00B7 ' + ratioLabel;
            pill.appendChild(tierSpan);
            pill.appendChild(ratioSpan);
            col.appendChild(pill);
          }
        };

        addPills(tierRows.a, 'A', '\u22653:1', 'pill-a');
        addPills(tierRows.aa, 'AA', '\u22654.5:1', 'pill-aa');
        addPills(tierRows.aaa, 'AAA', '\u22657:1', 'pill-aaa');
      });

      sourceRow.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!col.querySelector('.swatch-row:hover')) {
            clearHighlights();
          }
        }, 50);
      });
    });

    // Clear when mouse leaves the entire swatch list
    swatchList.addEventListener('mouseleave', clearHighlights);
  }
  
  _computeContrastFromHex(hex1, hex2) {
    const rgb1 = ColorEngine.hexToRgb(hex1);
    const rgb2 = ColorEngine.hexToRgb(hex2);
    return ColorEngine.contrastRatio(rgb1, rgb2);
  }



  _drawGradientStrip(canvas, scale) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    const steps = Math.max(h, 256);
    const stepH = h / steps;
    
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const step = t * 900;
      let L = this.manager.getLinearL(step);
      const C = ColorEngine.cubicHermiteInterpolate(scale.curvePoints.C, t);
      const H = ColorEngine.interpolateHue(scale.curvePoints.H, t);
      
      const gamut = ColorEngine.clampToGamut(
        Math.max(0, Math.min(1, L)),
        Math.max(0, C),
        ((H % 360) + 360) % 360
      );
      const hex = ColorEngine.oklchToHex(gamut.L, gamut.C, gamut.H);
      ctx.fillStyle = hex;
      ctx.fillRect(0, i * stepH, w, stepH + 1);
    }
    
  }

  _updateSelection() {
    const hasSelection = !!this.manager.selectedId;
    const hasSourcePanel = !!this._openSourcePanelId;
    document.querySelectorAll('.scale-column').forEach(col => {
      const isSelected = col.dataset.scaleId === this.manager.selectedId;
      col.classList.toggle('selected', isSelected);
      // Dim non-selected columns when curve editor is open (but not if a source panel is controlling dimming)
      if (hasSelection && !hasSourcePanel) {
        col.classList.toggle('dimmed', !isSelected);
      } else if (!hasSelection && !hasSourcePanel) {
        col.classList.remove('dimmed');
      }
    });
  }

  _renderCurvePanel() {
    const old = document.querySelector('.curve-panel');
    const wasAlreadyOpen = !!old;
    if (old) old.remove();
    
    const selected = this.manager.getSelected();
    if (!selected) return;
    
    const panel = document.createElement('div');
    panel.className = 'curve-panel';
    if (wasAlreadyOpen) panel.style.animation = 'none';
    
    const panelHeader = document.createElement('div');
    panelHeader.className = 'curve-panel-header';
    panelHeader.innerHTML = `
      <div class="curve-panel-title-wrap">
        <h2 class="curve-panel-title">Curve editor</h2>
        <span class="curve-scale-name">${selected.name}</span>
      </div>
      <div class="curve-panel-right">
        <button class="btn-icon btn-close-panel" id="btn-close-curve" data-tooltip="Close curve editor">
          ${icon('x',16)}
        </button>
      </div>
    `;
    panel.appendChild(panelHeader);
    
    const panelContent = document.createElement('div');
    panelContent.className = 'curve-panel-content';

    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'curve-canvas-container';
    panelContent.appendChild(canvasContainer);

    const sidebarWrap = document.createElement('div');
    sidebarWrap.className = 'curve-sidebar-wrap';
    const validationSidebar = this._createContrastValidation(selected);
    sidebarWrap.appendChild(validationSidebar);

    const help = document.createElement('div');
    help.className = 'curve-help';
    help.textContent = 'Click curve to add point · Drag to adjust · Right-click/dbl-click to remove · Red zones = contrast constraint limits';
    sidebarWrap.appendChild(help);

    panelContent.appendChild(sidebarWrap);

    panel.appendChild(panelContent);
    this.root.appendChild(panel);
    
    // Create curve editor
    if (this.curveEditor) this.curveEditor.destroy();
    this._curveUndoPushed = false;
    this.curveEditor = new CurveEditor(canvasContainer, (points) => {
      if (!this._curveUndoPushed) {
  
        this._curveUndoPushed = true;
      }
      // Only C and H come from the editor; L is fixed
      selected.curvePoints.C = points.C;
      selected.curvePoints.H = points.H;
      selected.generate();
      this._updateConstraintBounds(selected);
      this._updateSwatches(selected);
    });
    canvasContainer.addEventListener('mouseup', () => {
      this._curveUndoPushed = false;
      this._saveActiveSet();
    });

    // Set L as non-interactive reference line (linear schedule)
    this._setCurveEditorLReference();
    this.curveEditor.setPoints('C', selected.curvePoints.C);
    this.curveEditor.setPoints('H', selected.curvePoints.H);
    
    // Show constraint bounds
    this._updateConstraintBounds(selected);
    
    panel.querySelector('#btn-close-curve').addEventListener('click', () => {
      this._closeCurvePanel();
    });
  }

  _closeCurvePanel() {
    const panel = document.querySelector('.curve-panel');
    if (!panel) return;
    this.manager.selectedId = null;
    this._updateSelection();
    // Clear any inline animation override so close animation can play
    panel.style.animation = '';
    panel.classList.add('closing');
    panel.addEventListener('animationend', () => {
      panel.remove();
    }, { once: true });
  }

  _setCurveEditorLReference() {
    if (!this.curveEditor) return;
    // Set L as a two-point linear reference line
    this.curveEditor.setPoints('L', [
      { x: 0, y: this.manager.lightnessMax },
      { x: 1, y: this.manager.lightnessMin }
    ]);
  }

  _updateConstraintBounds(scale) {
    if (!this.curveEditor) return;
    const bounds = scale.getConstraintBounds();
    this.curveEditor.setConstraintBounds(bounds);
  }

  _createContrastValidation(scale) {
    const section = document.createElement('div');
    section.className = 'validation-section';
    
    const validation = scale.getContrastValidation();
    const failCount = validation.constrained.filter(v => !v.pass).length;
    const adjustCount = scale.steps.filter(s => s.adjusted).length;
    
    // Constraint status summary
    const statusDiv = document.createElement('div');
    statusDiv.className = 'constraint-status';
    
    if (failCount === 0) {
      statusDiv.innerHTML = `<span class="status-badge pass">✓ All constraints met</span>`;
    } else {
      statusDiv.innerHTML = `<span class="status-badge fail">${failCount} constraint${failCount > 1 ? 's' : ''} failed</span>`;
    }
    if (adjustCount > 0) {
      statusDiv.innerHTML += `<span class="status-badge adjusted">${adjustCount} step${adjustCount > 1 ? 's' : ''} adjusted</span>`;
    }
    section.appendChild(statusDiv);
    
    // Constraint pairs by tier
    const constrainedA = validation.constrained.filter(v => v.gap >= 400 && v.gap < 500);
    const constrainedAA = validation.constrained.filter(v => v.gap >= 500 && v.gap < 600);
    const constrainedAAA = validation.constrained.filter(v => v.gap >= 600);

    if (constrainedAAA.length > 0) {
      const detailsAAA = this._createConstraintGroup('AAA 7:1 pairs (≥600 gap)', constrainedAAA);
      section.appendChild(detailsAAA);
    }

    if (constrainedAA.length > 0) {
      const detailsAA = this._createConstraintGroup('AA 4.5:1 pairs (≥500 gap)', constrainedAA);
      section.appendChild(detailsAA);
    }

    if (constrainedA.length > 0) {
      const detailsA = this._createConstraintGroup('A 3:1 pairs (400–499 gap)', constrainedA);
      section.appendChild(detailsA);
    }
    
    return section;
  }

  _createConstraintGroup(title, items) {
    const failCount = items.filter(v => !v.pass).length;
    
    const details = document.createElement('details');
    details.className = 'validation-details';
    details.open = failCount > 0;
    
    const summary = document.createElement('summary');
    summary.className = 'validation-summary-row';
    summary.innerHTML = `
      <span class="validation-title">${title}</span>
      <span class="validation-summary ${failCount > 0 ? 'has-fails' : 'all-pass'}">${failCount > 0 ? failCount + ' fail' : '✓'}</span>
    `;
    details.appendChild(summary);
    
    const list = document.createElement('div');
    list.className = 'contrast-list';
    
    // Show a subset to avoid huge lists
    const displayed = items.length > 20 ? items.filter(v => !v.pass || v.ratio < v.required + 1) : items;
    const remaining = items.length - displayed.length;
    
    displayed.forEach(v => {
      const item = document.createElement('div');
      item.className = 'contrast-item' + (!v.pass ? ' contrast-fail' : '');
      item.innerHTML = `
        <span class="ci-pair">${v.from}→${v.to}</span>
        <span class="ci-ratio">${v.ratio.toFixed(2)}:1</span>
        <span class="ci-status ${v.pass ? 'ci-pass' : 'ci-fail'}">${v.pass ? '✓' : '✗'}</span>
      `;
      list.appendChild(item);
    });
    
    if (remaining > 0) {
      const more = document.createElement('div');
      more.className = 'contrast-item ci-more';
      more.textContent = `+ ${remaining} more passing`;
      list.appendChild(more);
    }
    
    details.appendChild(list);
    return details;
  }

  _updateSwatches(scale) {
    const col = document.querySelector(`[data-scale-id="${scale.id}"]`);
    if (!col) return;
    
    const newCol = this._createScaleColumn(scale);
    col.replaceWith(newCol);
    this._scheduleGradientResize();
    
    const validSection = document.querySelector('.validation-section');
    if (validSection) {
      const newValid = this._createContrastValidation(scale);
      validSection.replaceWith(newValid);
    }
  }

  _showExportModal() {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const modal = document.createElement('div');
    modal.className = 'modal';

    const copyIconSvg = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" stroke="currentColor" stroke-width="1.2"/></svg>';
    const checkIconSvg = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const downloadIconSvg = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v8m0 0L4 6.5m3 3 3-3M2 11.5h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const labelMap = { css: 'Copy CSS', 'w3c': 'Copy Tokens', tailwind: 'Copy Tailwind' };
    const downloadLabelMap = { css: 'Download CSS', 'w3c': 'Download Tokens', tailwind: 'Download Tailwind' };
    const fileNameMap = { css: 'colors.css', 'w3c': 'design-tokens.json', tailwind: 'tailwind-colors' };
    const mimeMap = { css: 'text/css', 'w3c': 'application/json', tailwind: 'text/plain' };

    const getTailwindVersion = () => modal.querySelector('#tailwind-version')?.value || 'v4';

    const getContent = (key) => {
      if (key === 'css') return this.manager.exportAllCSS();
      if (key === 'w3c') return this.manager.exportW3CTokens();
      if (key === 'tailwind') {
        return getTailwindVersion() === 'v3'
          ? this.manager.exportTailwindV3()
          : this.manager.exportTailwindV4();
      }
      return '';
    };

    const refreshContent = () => {
      modal.querySelectorAll('.export-section[data-panel]').forEach(panel => {
        const key = panel.dataset.panel;
        if (key === 'figma-api') return;
        const pre = panel.querySelector('.export-code');
        if (pre) pre.textContent = getContent(key);
      });
    };

    modal.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">Export scales</h2>
        <button class="btn-icon btn-close-modal">
          ${icon('x',16)}
        </button>
      </div>
      <div class="modal-tabs">
        <button class="modal-tab active" data-tab="css">CSS</button>
        <button class="modal-tab" data-tab="w3c">W3C Design Tokens</button>
        <button class="modal-tab" data-tab="tailwind">Tailwind</button>
        <button class="modal-tab" data-tab="figma-api">Figma API</button>
      </div>
      <div class="modal-body">
        <div class="export-section" data-panel="css">
          <pre class="export-code"></pre>
          <div class="export-actions">
            <button class="btn btn-secondary btn-copy-full" data-content="css">
              ${copyIconSvg} Copy CSS
            </button>
            <button class="btn btn-secondary btn-download" data-download="css">
              ${downloadIconSvg} Download CSS
            </button>
          </div>
        </div>
        <div class="export-section" data-panel="w3c" style="display:none">
          <p class="export-note">W3C Design Tokens format: compatible with <strong>Tokens Studio for Figma</strong> and variables import plugins.</p>
          <pre class="export-code"></pre>
          <div class="export-actions">
            <button class="btn btn-secondary btn-copy-full" data-content="w3c">
              ${copyIconSvg} Copy Tokens
            </button>
            <button class="btn btn-secondary btn-download" data-download="w3c">
              ${downloadIconSvg} Download Tokens
            </button>
          </div>
        </div>
        <div class="export-section" data-panel="tailwind" style="display:none">
          <div class="export-version-selector">
            <label for="tailwind-version">Tailwind version:</label>
            <select id="tailwind-version" class="export-select">
              <option value="v4" selected>v4 (CSS-based)</option>
              <option value="v3">v3 (JS config)</option>
            </select>
          </div>
          <pre class="export-code"></pre>
          <div class="export-actions">
            <button class="btn btn-secondary btn-copy-full" data-content="tailwind">
              ${copyIconSvg} Copy Tailwind
            </button>
            <button class="btn btn-secondary btn-download" data-download="tailwind">
              ${downloadIconSvg} Download Tailwind
            </button>
          </div>
        </div>
        <div class="export-section" data-panel="figma-api" style="display:none">
          <div id="figma-api-container"></div>
        </div>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Initial content render
    refreshContent();

    // Tailwind version selector refreshes tailwind panel
    modal.querySelector('#tailwind-version')?.addEventListener('change', () => {
      const pre = modal.querySelector('[data-panel="tailwind"] .export-code');
      if (pre) pre.textContent = getContent('tailwind');
    });

    modal.querySelector('.btn-close-modal').addEventListener('click', () => overlay.remove());
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
    });

    // Tab switching
    modal.querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        modal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        modal.querySelectorAll('.export-section').forEach(s => s.style.display = 'none');
        modal.querySelector(`[data-panel="${tab.dataset.tab}"]`).style.display = '';
      });
    });

    // Copy buttons
    modal.querySelectorAll('.btn-copy-full').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.content;
        const content = getContent(key);
        navigator.clipboard.writeText(content).then(() => {
          btn.innerHTML = checkIconSvg + ' Copied!';
          setTimeout(() => { btn.innerHTML = copyIconSvg + ' ' + labelMap[key]; }, 1500);
        });
      });
    });

    // Download buttons
    modal.querySelectorAll('.btn-download').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.download;
        const content = getContent(key);
        let fileName = fileNameMap[key];
        if (key === 'tailwind') {
          fileName += getTailwindVersion() === 'v3' ? '.js' : '.css';
        }
        const blob = new Blob([content], { type: mimeMap[key] });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        btn.innerHTML = checkIconSvg + ' Downloaded!';
        setTimeout(() => { btn.innerHTML = downloadIconSvg + ' ' + downloadLabelMap[key]; }, 1500);
      });
    });

    // Initialize Figma API panel when its tab is first shown
    let figmaApiInitialized = false;
    const initFigmaApi = () => {
      if (figmaApiInitialized) return;
      figmaApiInitialized = true;
      const apiContainer = modal.querySelector('#figma-api-container');
      if (apiContainer && window.figmaPusher) {
        window.figmaPusher.renderPanel(apiContainer, this.manager);
      }
    };

    modal.querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === 'figma-api') initFigmaApi();
      });
    });
  }

  _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  window.app = new App();
  await window.app.init();
});
