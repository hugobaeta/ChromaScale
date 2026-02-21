// ChromaScale — UI Controller v3
// Compact 35-step layout with contrast constraint enforcement

class App {
  constructor() {
    this.manager = new ScaleManager();
    this.curveEditor = null;
    this.viewMode = 'light';
    this.root = document.getElementById('app');
    this.STORAGE_KEY = 'chromascale-color-scales';
    this._openSourcePanelId = null;
    
    this.DEFAULTS = {
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
    
    // Try to load from localStorage, otherwise use defaults
    const loaded = this._loadFromLocalStorage();
    if (!loaded) {
      this._loadDefaults();
    }
    
    // Start with no scale selected — curve panel hidden until user clicks
    this.manager.selectedId = null;
    
    this._initTooltipSystem();
    this._render();
    this._scheduleGradientResize();
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

  _positionModeSlider(animate = true) {
    const toggle = document.getElementById('mode-toggle');
    const slider = document.getElementById('mode-slider');
    if (!toggle || !slider) return;
    
    const activeBtn = toggle.querySelector('.mode-btn.active');
    if (!activeBtn) return;
    
    const toggleRect = toggle.getBoundingClientRect();
    const activeRect = activeBtn.getBoundingClientRect();
    
    if (!animate) slider.style.transition = 'none';
    slider.style.left = (activeRect.left - toggleRect.left) + 'px';
    slider.style.width = activeRect.width + 'px';
    slider.style.height = activeRect.height + 'px';
    if (!animate) {
      slider.offsetHeight; // force reflow
      slider.style.transition = '';
    }
  }

  _loadDefaults() {
    this.manager.scales = [];
    for (const [name, colors] of Object.entries(this.DEFAULTS)) {
      this.manager.addScale(name, colors);
    }
  }

  _saveToLocalStorage() {
    try {
      const data = {
        lightnessMax: this.manager.lightnessMax,
        lightnessMin: this.manager.lightnessMin,
        darkLightnessMax: this.manager.darkLightnessMax,
        darkLightnessMin: this.manager.darkLightnessMin,
        scales: this.manager.scales.map(s => ({
          name: s.name,
          keyColors: s.keyColors
        }))
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
      
      // Show brief confirmation
      this._showToast('Scales saved to local storage');
    } catch (e) {
      this._showToast('Failed to save: ' + e.message, true);
    }
  }

  _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return false;

      const data = JSON.parse(raw);

      // Migration: old format was an array of per-scale objects
      if (Array.isArray(data)) {
        if (data.length === 0) return false;
        // Read limits from first scale's old property names
        const first = data[0];
        if (first.whiteLimit != null) this.manager.lightnessMax = first.whiteLimit;
        if (first.blackLimit != null) this.manager.lightnessMin = first.blackLimit;
        if (first.darkWhiteLimit != null) this.manager.darkLightnessMax = first.darkWhiteLimit;
        if (first.darkBlackLimit != null) this.manager.darkLightnessMin = first.darkBlackLimit;
        this.manager.scales = [];
        data.forEach(item => {
          this.manager.addScale(item.name, item.keyColors);
        });
        return true;
      }

      // New format: object with scales array and top-level limits
      if (!data.scales || data.scales.length === 0) return false;

      // Read limits (try new names first, fall back to old names)
      if (data.lightnessMax != null) this.manager.lightnessMax = data.lightnessMax;
      else if (data.whiteLimit != null) this.manager.lightnessMax = data.whiteLimit;

      if (data.lightnessMin != null) this.manager.lightnessMin = data.lightnessMin;
      else if (data.blackLimit != null) this.manager.lightnessMin = data.blackLimit;

      if (data.darkLightnessMax != null) this.manager.darkLightnessMax = data.darkLightnessMax;
      else if (data.darkWhiteLimit != null) this.manager.darkLightnessMax = data.darkWhiteLimit;

      if (data.darkLightnessMin != null) this.manager.darkLightnessMin = data.darkLightnessMin;
      else if (data.darkBlackLimit != null) this.manager.darkLightnessMin = data.darkBlackLimit;

      this.manager.scales = [];
      data.scales.forEach(item => {
        this.manager.addScale(item.name, item.keyColors);
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  _resetToDefaults() {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (e) { /* ignore */ }
    
    this.manager.scales = [];
    this._loadDefaults();
    this.manager.selectedId = null;
    this._render();
    this._scheduleGradientResize();
    this._showToast('Reset to defaults');
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
      gradCanvas.style.height = rounded + 'px';
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
          const sourceWrap = col.querySelector('.source-colors-wrap');
          this._showSourcePopover(col, scale, sourceWrap, true);
        }
      }
    }
  }

  _applyThemeFromScale() {
    const scale = this.manager.scales[0];
    if (!scale) return;
    
    const root = document.documentElement;
    const isDark = this.viewMode === 'dark';
    
    // Both light and dark modes use direct label mapping.
    // Dark steps are already generated with the correct semantic meaning
    // at each label (0 = bg, 200 = border, 850 = text, etc.)
    const steps = isDark ? (scale.darkSteps || []) : scale.steps;
    const stepMap = {};
    steps.forEach(s => { stepMap[s.label] = s.hex; });
    
    root.style.setProperty('--bg', stepMap[0] || (isDark ? '#0f0e0d' : '#ffffff'));
    root.style.setProperty('--bg-subtle', stepMap[20] || stepMap[0]);
    root.style.setProperty('--bg-muted', stepMap[60] || stepMap[50]);
    root.style.setProperty('--bg-alt', stepMap[50] || stepMap[0]);
    root.style.setProperty('--border', stepMap[200] || stepMap[150]);
    root.style.setProperty('--border-strong', stepMap[300] || stepMap[250]);
    root.style.setProperty('--border-hover', stepMap[400] || stepMap[350]);
    root.style.setProperty('--text', stepMap[850] || stepMap[900]);
    root.style.setProperty('--text-secondary', stepMap[600] || stepMap[550]);
    root.style.setProperty('--text-muted', stepMap[450] || stepMap[400]);
    root.style.setProperty('--text-muted-strong', stepMap[650] || stepMap[600] || stepMap[550]);
    root.style.setProperty('--accent', stepMap[850] || stepMap[900]);
    root.style.setProperty('--accent-fg', stepMap[0] || (isDark ? '#0f0e0d' : '#ffffff'));
    root.style.setProperty('--hover', stepMap[50] || stepMap[100]);
    root.style.setProperty('--outline-active', stepMap[550] || stepMap[500] || stepMap[450]);
  }

  _renderHeader() {
    const header = document.createElement('header');
    header.className = 'app-header';
    header.innerHTML = `
      <div class="header-left">
        <h1 class="app-title">ChromaScale</h1>
        <span class="app-subtitle">OKLCH color scale tool</span>
      </div>
      <div class="header-center">
        <div class="mode-toggle" id="mode-toggle">
          <div class="mode-slider" id="mode-slider"></div>
          <button class="mode-btn ${this.viewMode === 'light' ? 'active' : ''}" data-mode="light">
            <span class="mode-icon mode-icon-outline">${icon('sun',14)}</span>
            <span class="mode-icon mode-icon-filled">${icon('sun',14)}</span>
            <span class="mode-label">Light</span>
          </button>
          <button class="mode-btn ${this.viewMode === 'dark' ? 'active' : ''}" data-mode="dark">
            <span class="mode-icon mode-icon-outline">${icon('moon',14)}</span>
            <span class="mode-icon mode-icon-filled">${icon('moon',14)}</span>
            <span class="mode-label">Dark</span>
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
        <button class="btn btn-secondary btn-icon-only" id="btn-save" data-tooltip="Save">
          ${icon('floppy-disk',16)}
        </button>
        <button class="btn btn-secondary btn-icon-only" id="btn-reset" data-tooltip="Reset">
          ${icon('arrow-counter-clockwise',16)}
        </button>
        <button class="btn btn-primary" id="btn-export">
          ${icon('export',16)}
          Export
        </button>
      </div>
    `;
    this.root.appendChild(header);
    
    // Position the slider over the active button after layout
    requestAnimationFrame(() => this._positionModeSlider(false));
    
    header.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const oldMode = this.viewMode;
        const newMode = btn.dataset.mode;
        if (oldMode === newMode) return;
        
        // Capture old slider position before re-render
        const oldSlider = document.getElementById('mode-slider');
        const oldLeft = oldSlider ? parseFloat(oldSlider.style.left) : 0;
        const oldWidth = oldSlider ? parseFloat(oldSlider.style.width) : 0;
        
        // Update state
        this.viewMode = newMode;
        document.body.classList.toggle('dark-mode', newMode === 'dark');
        
        // Enable theme color transition on :root
        document.documentElement.classList.add('theme-transitioning');
        
        if (this.curveEditor) this.curveEditor.invalidateTheme();
        this._render();
        
        // FLIP: after render, the new slider exists at the NEW position.
        // Set it to OLD position (no transition), then animate to NEW.
        const slider = document.getElementById('mode-slider');
        if (slider && !isNaN(oldLeft)) {
          // Disable slider transition, jump to old position
          slider.style.transition = 'none';
          slider.style.left = oldLeft + 'px';
          slider.style.width = oldWidth + 'px';
          slider.offsetHeight; // force reflow
          
          // Re-enable transition and animate to new position
          slider.style.transition = '';
          this._positionModeSlider(true);
        }
        
        // Remove theme transition class after it finishes
        clearTimeout(this._themeTransitionTimer);
        this._themeTransitionTimer = setTimeout(() => {
          document.documentElement.classList.remove('theme-transitioning');
        }, 150);
      });
    });

    header.querySelector('#btn-add-scale').addEventListener('click', () => {

      const colors = ['#8B5CF6', '#D97757', '#06B6D4', '#EC4899', '#84CC16', '#F59E0B'];
      const names = ['Custom', 'Clay', 'Teal', 'Pink', 'Lime', 'Amber'];
      const idx = this.manager.scales.length % colors.length;
      this.manager.addScale(names[idx] || 'New', colors[idx] || '#8B5CF6');
      this._render();
    });
    
    header.querySelector('#btn-settings').addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleSettingsPopover(header.querySelector('.settings-wrap'));
    });
    header.querySelector('#btn-save').addEventListener('click', () => this._saveToLocalStorage());
    header.querySelector('#btn-reset').addEventListener('click', () => this._resetToDefaults());
    header.querySelector('#btn-export').addEventListener('click', () => this._showExportModal());
  }

  _toggleSettingsPopover(anchor) {
    const existing = anchor.querySelector('.settings-popover');
    if (existing) { existing.remove(); return; }
    
    // Close any other popovers
    document.querySelectorAll('.settings-popover').forEach(p => p.remove());
    
    // Read current values from manager (global limits)
    const whiteLimit = this.manager.lightnessMax;
    const blackLimit = this.manager.lightnessMin;
    const darkWhiteLimit = this.manager.darkLightnessMax;
    const darkBlackLimit = this.manager.darkLightnessMin;
    
    const popover = document.createElement('div');
    popover.className = 'settings-popover';
    popover.innerHTML = `
      <div class="settings-section">
        <div class="settings-popover-header">Light Mode</div>
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
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-popover-header">Dark Mode</div>
        <div class="settings-popover-body">
          <div class="settings-row">
            <label class="settings-label">Darkest point <span class="settings-hint">(step 0)</span></label>
            <input type="number" class="control-input" id="settings-dark-black-limit"
              value="${darkBlackLimit.toFixed(2)}" min="0" max="0.5" step="0.01">
          </div>
          <div class="settings-row">
            <label class="settings-label">Lightest point <span class="settings-hint">(step 900)</span></label>
            <input type="number" class="control-input" id="settings-dark-white-limit"
              value="${darkWhiteLimit.toFixed(2)}" min="0.5" max="1" step="0.01">
          </div>
        </div>
      </div>
    `;
    anchor.appendChild(popover);
    
    // Bind change handlers
    popover.querySelector('#settings-white-limit').addEventListener('change', (e) => {

      this.manager.setLightnessMax(parseFloat(e.target.value));
      const selected = this.manager.getSelected();
      if (selected && this.curveEditor) {
        this._setCurveEditorLReference();
        this._updateConstraintBounds(selected);
      }
      this._render();
      this._scheduleGradientResize();
    });

    popover.querySelector('#settings-black-limit').addEventListener('change', (e) => {

      this.manager.setLightnessMin(parseFloat(e.target.value));
      const selected = this.manager.getSelected();
      if (selected && this.curveEditor) {
        this._setCurveEditorLReference();
        this._updateConstraintBounds(selected);
      }
      this._render();
      this._scheduleGradientResize();
    });

    // Dark mode limit handlers
    popover.querySelector('#settings-dark-black-limit').addEventListener('change', (e) => {

      this.manager.setDarkLightnessMin(parseFloat(e.target.value));
      const selected = this.manager.getSelected();
      if (selected && this.curveEditor) {
        this._setCurveEditorLReference();
        this._updateConstraintBounds(selected);
      }
      this._render();
      this._scheduleGradientResize();
    });

    popover.querySelector('#settings-dark-white-limit').addEventListener('change', (e) => {

      this.manager.setDarkLightnessMax(parseFloat(e.target.value));
      const selected = this.manager.getSelected();
      if (selected && this.curveEditor) {
        this._setCurveEditorLReference();
        this._updateConstraintBounds(selected);
      }
      this._render();
      this._scheduleGradientResize();
    });
    
    // Close when clicking outside
    const closeOnOutside = (e) => {
      if (!popover.contains(e.target) && !anchor.contains(e.target)) {
        popover.remove();
        document.removeEventListener('mousedown', closeOnOutside);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 10);
  }

  _renderMain() {
    const main = document.createElement('div');
    main.className = 'scales-container';
    
    this.manager.scales.forEach(scale => {
      const col = this._createScaleColumn(scale);
      main.appendChild(col);
    });
    
    this.root.appendChild(main);
  }

  _createScaleColumn(scale) {
    const col = document.createElement('div');
    col.className = 'scale-column' + (scale.id === this.manager.selectedId ? ' selected' : '');
    col.dataset.scaleId = scale.id;
    
    // Set step 0 color for the selected column's box-shadow
    const step0 = scale.getSteps(this.viewMode).find(s => s.label === 0);
    if (step0) col.style.setProperty('--scale-step0', step0.hex);
    
    // No column-level click — graph opens via per-step button instead

    // Scale header
    const header = document.createElement('div');
    header.className = 'scale-header';
    
    // Drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle';
    dragHandle.setAttribute('data-tooltip', 'Drag to reorder');
    dragHandle.innerHTML = icon('dots-six-vertical',14);
    header.appendChild(dragHandle);

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
    });
    header.appendChild(nameInput);
    
    const validation = this.viewMode === 'dark' ? scale.getDarkContrastValidation() : scale.getContrastValidation();
    const failCount = validation.constrained.filter(v => !v.pass).length;
    const adjustCount = scale.getSteps(this.viewMode).filter(s => s.adjusted).length;
    
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
      // Close any other open dropdowns and remove active state from other buttons
      document.querySelectorAll('.scale-dropdown').forEach(d => d.remove());
      document.querySelectorAll('.btn-more.active').forEach(b => b.classList.remove('active'));
      moreBtn.classList.add('active');
      this._showScaleDropdown(moreWrap, col, scale);
    });
    moreWrap.appendChild(moreBtn);
    header.appendChild(moreWrap);

    col.appendChild(header);

    // Source colors button (below header)
    const sourceWrap = document.createElement('div');
    sourceWrap.className = 'source-colors-wrap';
    
    const sourceBtn = document.createElement('button');
    sourceBtn.className = 'btn-source-colors';
    const previewSwatches = scale.keyColors.slice(0, 7).map(hex => 
      `<span class="source-mini-swatch" style="background:${hex}"></span>`
    ).join('');
    const moreCount = scale.keyColors.length > 7 ? `<span class="source-more">+${scale.keyColors.length - 7}</span>` : '';
    sourceBtn.innerHTML = `<span class="source-swatches-row">${previewSwatches}${moreCount}</span><span class="source-label">Source colors</span>`;
    sourceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = col.querySelector('.source-panel');
      if (existing) {
        this._closeSourcePanel(existing);
        return;
      }
      document.querySelectorAll('.source-panel').forEach(p => this._closeSourcePanel(p));
      this._showSourcePopover(col, scale, sourceWrap);
    });
    sourceWrap.appendChild(sourceBtn);
    
    if (adjustCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'header-badge adjusted-badge';
      badge.textContent = `${adjustCount} adj`;
      badge.setAttribute('data-tooltip', `${adjustCount} steps auto-adjusted to meet contrast constraints`);
      sourceWrap.appendChild(badge);
    }
    
    col.appendChild(sourceWrap);

    // Swatch area (no gradient strip in normal view)
    const swatchArea = document.createElement('div');
    swatchArea.className = 'swatch-area';

    // Compact swatch list
    const swatchList = document.createElement('div');
    swatchList.className = 'swatch-list';
    
    const stepsToRender = scale.getSteps(this.viewMode);
    stepsToRender.forEach((step) => {

      
      const isMinor = !step.isMajor;
      
      const row = document.createElement('div');
      row.className = 'swatch-row' + (isMinor ? ' minor' : '') + (step.adjusted ? ' adjusted' : '');
      row.dataset.label = step.label;
      row.dataset.hex = step.hex;
      // No tooltip on swatch rows — hex is already visible
      
      const swatchColor = document.createElement('div');
      swatchColor.className = 'swatch-color';
      swatchColor.style.backgroundColor = step.hex;
      
      if (step.clamped) {
        const warn = document.createElement('span');
        warn.className = 'gamut-dot';
        warn.setAttribute('data-tooltip', 'Gamut-clamped');
        swatchColor.appendChild(warn);
      }
      if (step.adjusted) {
        const adj = document.createElement('span');
        adj.className = 'adjusted-dot';
        adj.setAttribute('data-tooltip', `L adjusted: ${step.desiredL.toFixed(3)} → ${step.effectiveL.toFixed(3)}`);
        swatchColor.appendChild(adj);
      }
      
      const swatchInfo = document.createElement('div');
      swatchInfo.className = 'swatch-info';
      
      const labelHex = document.createElement('div');
      labelHex.className = 'swatch-label-hex';
      labelHex.innerHTML = `<span class="step-label">${step.label}</span><span class="hex-value">${step.hex.toUpperCase()}</span>`;
      
      swatchInfo.appendChild(labelHex);
      
      // Show OKLCH on major steps only (to save space)
      if (step.isMajor) {
        const oklchLine = document.createElement('div');
        oklchLine.className = 'swatch-oklch';
        oklchLine.textContent = `L${step.oklch.L.toFixed(2)} C${step.oklch.C.toFixed(3)} H${step.oklch.H.toFixed(0)}`;
        swatchInfo.appendChild(oklchLine);
      }
      
      // Hover action buttons
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
        // Highlight this step's position on the curves
        if (this.curveEditor) {
          this.curveEditor.setHighlightT(step.t);
        }
      });
      actions.appendChild(graphBtn);
      
      row.appendChild(swatchColor);
      row.appendChild(swatchInfo);
      row.appendChild(actions);
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
        icon: icon('grid-four',16),
        action: () => {
          dropdown.remove();
          // Re-check at action time since state may have changed
          const sourceWrap = col.querySelector('.source-colors-wrap');
          const existing = col.querySelector('.source-panel:not(.closing)');
          if (existing) { this._closeSourcePanel(existing); return; }
          document.querySelectorAll('.source-panel').forEach(p => this._closeSourcePanel(p));
          this._showSourcePopover(col, scale, sourceWrap);
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
    gradCanvas.style.width = '48px';
    
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

      scale.addKeyColor('#D97757');
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
      nativeInput.addEventListener('change', () => { this._colorPickerUndoPushed = false; });
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
        gradCanvas.style.height = h + 'px';
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
      // Highlight drop target
      document.querySelectorAll('.scale-column').forEach(c => {
        c.classList.remove('drag-over', 'drag-over-left', 'drag-over-right');
        if (c === col) return;
        const rect = c.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          c.classList.add('drag-over');
          const midX = rect.left + rect.width / 2;
          if (e.clientX < midX) {
            c.classList.add('drag-over-left');
          } else {
            c.classList.add('drag-over-right');
          }
        }
      });
    };
    
    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      col.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      // Find which column we're over
      const allCols = [...document.querySelectorAll('.scale-column')];
      let targetCol = null;
      let insertAfter = false;
      
      allCols.forEach(c => {
        c.classList.remove('drag-over', 'drag-over-left', 'drag-over-right');
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
        const badge = r.querySelector('.contrast-ratio-badge');
        if (badge) badge.remove();
        const zoneLabel = r.querySelector('.contrast-zone-label');
        if (zoneLabel) zoneLabel.remove();
      });
    };

    rows.forEach(sourceRow => {
      sourceRow.addEventListener('mouseenter', () => {
        clearHighlights();

        const sourceLabel = parseInt(sourceRow.dataset.label);
        const sourceHex = sourceRow.dataset.hex;

        col.classList.add('contrast-hover');
        sourceRow.classList.add('hover-source');

        // Track zone boundaries for labels
        let firstA = null, firstAup = null;
        let firstAA = null, firstAAup = null;
        let firstAAA = null, firstAAAup = null;

        rows.forEach(targetRow => {
          if (targetRow === sourceRow) return;

          const targetLabel = parseInt(targetRow.dataset.label);
          const targetHex = targetRow.dataset.hex;
          const gap = Math.abs(targetLabel - sourceLabel);
          const ratio = this._computeContrastFromHex(sourceHex, targetHex);
          const isAbove = targetLabel < sourceLabel;

          // Determine tier from gap
          let tierClass;
          if (gap >= 600) {
            tierClass = 'contrast-aaa';
            if (!isAbove && (!firstAAA || targetLabel < parseInt(firstAAA.dataset.label))) firstAAA = targetRow;
            if (isAbove && (!firstAAAup || targetLabel > parseInt(firstAAAup.dataset.label))) firstAAAup = targetRow;
          } else if (gap >= 500) {
            tierClass = 'contrast-aa';
            if (!isAbove && (!firstAA || targetLabel < parseInt(firstAA.dataset.label))) firstAA = targetRow;
            if (isAbove && (!firstAAup || targetLabel > parseInt(firstAAup.dataset.label))) firstAAup = targetRow;
          } else if (gap >= 400) {
            tierClass = 'contrast-a';
            if (!isAbove && (!firstA || targetLabel < parseInt(firstA.dataset.label))) firstA = targetRow;
            if (isAbove && (!firstAup || targetLabel > parseInt(firstAup.dataset.label))) firstAup = targetRow;
          } else {
            tierClass = 'contrast-none';
          }

          targetRow.classList.add(tierClass);
          const badge = document.createElement('span');
          badge.className = 'contrast-ratio-badge';
          badge.textContent = `${ratio.toFixed(1)}:1`;
          targetRow.appendChild(badge);
        });

        // Add zone boundary labels at the first row of each zone
        const addZoneLabel = (row, text, cls) => {
          if (!row) return;
          const label = document.createElement('span');
          label.className = 'contrast-zone-label ' + cls;
          label.textContent = text;
          row.appendChild(label);
        };

        addZoneLabel(firstA || firstAup, 'A ≥3:1', 'zone-label-a');
        addZoneLabel(firstAA || firstAAup, 'AA ≥4.5:1', 'zone-label-aa');
        addZoneLabel(firstAAA || firstAAAup, 'AAA ≥7:1', 'zone-label-aaa');
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
    
    const isDark = this.viewMode === 'dark';
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const step = t * 900;
      let L = isDark ? this.manager.getDarkLinearL(step) : this.manager.getLinearL(step);
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
    canvasContainer.addEventListener('mouseup', () => { this._curveUndoPushed = false; });

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
    
    const validation = this.viewMode === 'dark' ? scale.getDarkContrastValidation() : scale.getContrastValidation();
    const failCount = validation.constrained.filter(v => !v.pass).length;
    const adjustCount = scale.getSteps(this.viewMode).filter(s => s.adjusted).length;
    
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
    
    const cssOutput = this.manager.exportAllCSS();
    const jsonOutput = this.manager.exportAllJSON();
    const figmaOutput = this.manager.exportFigmaTokens();
    
    modal.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">Export scales</h2>
        <button class="btn-icon btn-close-modal">
          ${icon('x',16)}
        </button>
      </div>
      <div class="modal-tabs">
        <button class="modal-tab active" data-tab="css">CSS</button>
        <button class="modal-tab" data-tab="json">JSON</button>
        <button class="modal-tab" data-tab="figma-json">Figma JSON</button>
        <button class="modal-tab" data-tab="figma-api">Figma API</button>
      </div>
      <div class="modal-body">
        <div class="export-section" data-panel="css">
          <pre class="export-code">${this._escapeHtml(cssOutput)}</pre>
          <div class="export-actions">
            <button class="btn btn-secondary btn-copy-full" data-content="css">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" stroke="currentColor" stroke-width="1.2"/></svg>
              Copy CSS
            </button>
            <button class="btn btn-secondary btn-download" data-download="css">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v8m0 0L4 6.5m3 3 3-3M2 11.5h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Download CSS
            </button>
          </div>
        </div>
        <div class="export-section" data-panel="json" style="display:none">
          <pre class="export-code">${this._escapeHtml(jsonOutput)}</pre>
          <div class="export-actions">
            <button class="btn btn-secondary btn-copy-full" data-content="json">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" stroke="currentColor" stroke-width="1.2"/></svg>
              Copy JSON
            </button>
            <button class="btn btn-secondary btn-download" data-download="json">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v8m0 0L4 6.5m3 3 3-3M2 11.5h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Download JSON
            </button>
          </div>
        </div>
        <div class="export-section" data-panel="figma-json" style="display:none">
          <p class="export-note">W3C Design Tokens format: compatible with <strong>Tokens Studio for Figma</strong> and variables import plugins.</p>
          <pre class="export-code">${this._escapeHtml(figmaOutput)}</pre>
          <div class="export-actions">
            <button class="btn btn-secondary btn-copy-full" data-content="figma-json">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" stroke="currentColor" stroke-width="1.2"/></svg>
              Copy Figma Tokens
            </button>
            <button class="btn btn-secondary btn-download" data-download="figma-json">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v8m0 0L4 6.5m3 3 3-3M2 11.5h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Download Figma JSON
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
    
    modal.querySelector('.btn-close-modal').addEventListener('click', () => overlay.remove());
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
    });
    
    modal.querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        modal.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        modal.querySelectorAll('.export-section').forEach(s => s.style.display = 'none');
        modal.querySelector(`[data-panel="${tab.dataset.tab}"]`).style.display = '';
      });
    });
    
    const contentMap = { css: cssOutput, json: jsonOutput, 'figma-json': figmaOutput };
    const copyIconSvg = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" stroke="currentColor" stroke-width="1.2"/></svg>';
    const checkIconSvg = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const downloadIconSvg = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5v8m0 0L4 6.5m3 3 3-3M2 11.5h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const labelMap = { css: 'Copy CSS', json: 'Copy JSON', 'figma-json': 'Copy Figma Tokens' };
    const downloadLabelMap = { css: 'Download CSS', json: 'Download JSON', 'figma-json': 'Download Figma JSON' };
    const fileNameMap = { css: 'colors.css', json: 'colors.json', 'figma-json': 'figma-colors.json' };
    const mimeMap = { css: 'text/css', json: 'application/json', 'figma-json': 'application/json' };
    
    modal.querySelectorAll('.btn-copy-full').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.content;
        const content = contentMap[key];
        navigator.clipboard.writeText(content).then(() => {
          btn.innerHTML = checkIconSvg + ' Copied!';
          setTimeout(() => { btn.innerHTML = copyIconSvg + ' ' + labelMap[key]; }, 1500);
        });
      });
    });
    
    modal.querySelectorAll('.btn-download').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.download;
        const content = contentMap[key];
        const blob = new Blob([content], { type: mimeMap[key] });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileNameMap[key];
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

    // Check if figma-api tab is already active (it won't be by default)
    modal.querySelectorAll('.modal-tab').forEach(tab => {
      const origHandler = () => {
        if (tab.dataset.tab === 'figma-api') initFigmaApi();
      };
      tab.addEventListener('click', origHandler);
    });
  }

  _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
