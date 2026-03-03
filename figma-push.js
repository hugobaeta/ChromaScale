// ChromaScale — Figma Push Module v5
// Diff-and-map workflow: load existing collection variables, per-scale mapping
// (local → Figma prefix or skip), step-mismatch detection with strategy toggle.

class FigmaPusher {
  constructor() {
    this.STORAGE_KEY_PAT = 'chromascale-figma-pat';
    this.STORAGE_KEY_FILE = 'chromascale-figma-file';
    this.STORAGE_KEY_COLLECTION = 'chromascale-figma-collection';

    // All form state lives here; render() is a pure view of this.state.
    this.state = null;
    this._container = null;
    this._manager = null;
  }

  _initState() {
    return {
      pat: this.loadPref(this.STORAGE_KEY_PAT),
      fileUrl: this.loadPref(this.STORAGE_KEY_FILE),
      collectionName: this.loadPref(this.STORAGE_KEY_COLLECTION) || 'Colors',

      // Runtime (cleared on panel reopen)
      loadedCollections: null,   // null=not loaded, []=empty, [{id,name,...}]
      allVariables: null,        // full data.meta.variables from fetch
      targetCollection: null,    // {id, name, defaultModeId} or null=create-new
      collectionAnalysis: null,  // { prefixes: {gray: {steps:[], vars:{}}}, allSteps:Set }
      scaleMapping: {},          // { [localScaleName]: 'skip' | 'new' | figmaPrefix }
      stepStrategy: 'existing-only', // or 'add-missing'

      loading: false,
      loadError: '',
    };
  }

  // --- API layer ---

  // Fetch collections + variables from the file in one call.
  // /variables/local returns both collections and variables.
  async fetchFile(pat, fileKey) {
    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/variables/local`, {
      headers: { 'X-Figma-Token': pat }
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Figma API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const collections = Object.values(data.meta?.variableCollections || {})
      .filter(c => !c.remote)
      .map(c => ({
        id: c.id,
        name: c.name,
        modes: c.modes || [],
        defaultModeId: c.defaultModeId,
        variableCount: (c.variableIds || []).length
      }));
    return {
      collections,
      variables: data.meta?.variables || {}
    };
  }

  // Parse all COLOR variables in a collection into prefix→step→varId map.
  // Variable names are expected to follow "{prefix}/{step}" convention.
  analyzeCollection(variables, collectionId) {
    const colVars = Object.values(variables).filter(
      v => v.variableCollectionId === collectionId && v.resolvedType === 'COLOR'
    );
    const prefixes = {};
    for (const v of colVars) {
      const m = v.name.match(/^(.+)\/(\d+)$/);
      if (!m) continue;
      const [, prefix, stepStr] = m;
      const step = parseInt(stepStr, 10);
      if (!prefixes[prefix]) prefixes[prefix] = { steps: [], vars: {} };
      prefixes[prefix].steps.push(step);
      prefixes[prefix].vars[step] = v.id;
    }
    for (const p of Object.values(prefixes)) p.steps.sort((a, b) => a - b);
    const allSteps = new Set(Object.values(prefixes).flatMap(p => p.steps));
    return { prefixes, allSteps };
  }

  // Auto-match local scale names → Figma prefixes by normalized name.
  // Unmatched locals default to 'skip'.
  autoMap(localScales, figmaPrefixes) {
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const figmaNorm = Object.keys(figmaPrefixes).map(p => [normalize(p), p]);
    const mapping = {};
    for (const scale of localScales) {
      const norm = normalize(scale.name);
      const match = figmaNorm.find(([n]) => n === norm);
      mapping[scale.name] = match ? match[1] : 'skip';
    }
    return mapping;
  }

  // --- Payload construction ---

  parseFileKey(input) {
    if (!input) return null;
    input = input.trim();
    const urlMatch = input.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    if (/^[a-zA-Z0-9]{10,}$/.test(input)) return input;
    return null;
  }

  hexToFigmaColor(hex) {
    const rgb = ColorEngine.hexToRgb(hex);
    return { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255, a: 1 };
  }

  _hexForStep(scale, step) {
    const existing = scale.steps.find(s => s.label === step);
    return existing ? existing.hex : scale.sampleStep(step).hex;
  }

  _stepsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Build the POST payload + summary counts.
  // Uses this.state for mapping/strategy; returns { payload, summary }.
  buildPayload(manager) {
    const { targetCollection, collectionAnalysis, scaleMapping, stepStrategy, collectionName } = this.state;
    const steps = manager.stepLabels;
    const useExisting = !!targetCollection;

    const variables = [];
    const modeValues = [];
    const colId = useExisting ? targetCollection.id : 'tmp_col_' + Date.now();
    const modeId = useExisting ? targetCollection.defaultModeId : 'tmp_mode_default';

    let createCount = 0, updateCount = 0;
    const activeScales = [];

    for (const scale of manager.scales) {
      // When no existing collection is targeted, push all scales as new.
      // When targeting an existing collection, use the per-scale mapping.
      const target = useExisting ? (scaleMapping[scale.name] || 'skip') : 'new';
      if (target === 'skip') continue;
      activeScales.push(scale.name);

      const localPrefix = scale.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const isNew = target === 'new' || !collectionAnalysis?.prefixes[target];
      const figmaPrefix = isNew ? localPrefix : target;
      const existingSteps = isNew ? {} : collectionAnalysis.prefixes[target].vars;

      for (const step of steps) {
        const varName = `${figmaPrefix}/${step}`;
        const existingVarId = existingSteps[step];
        const hex = this._hexForStep(scale, step);

        if (existingVarId) {
          variables.push({ action: 'UPDATE', id: existingVarId, name: varName });
          modeValues.push({
            variableId: existingVarId, modeId,
            value: this.hexToFigmaColor(hex),
          });
          updateCount++;
        } else if (isNew || stepStrategy === 'add-missing') {
          const tmpId = `tmp_${figmaPrefix}_${step}`;
          variables.push({
            action: 'CREATE', id: tmpId, name: varName,
            variableCollectionId: colId, resolvedType: 'COLOR',
          });
          modeValues.push({
            variableId: tmpId, modeId,
            value: this.hexToFigmaColor(hex),
          });
          createCount++;
        }
        // else: existing-only strategy + no existing var at this step → skip
      }
    }

    const payload = { variables, variableModeValues: modeValues };
    if (useExisting) {
      payload.variableCollections = [];
      payload.variableModes = [];
    } else {
      payload.variableCollections = [{
        action: 'CREATE', id: colId,
        name: collectionName || 'Colors',
        initialModeId: modeId
      }];
      payload.variableModes = [
        { action: 'UPDATE', id: modeId, name: 'Default', variableCollectionId: colId }
      ];
    }
    return { payload, summary: { createCount, updateCount, activeScales } };
  }

  async push(pat, fileKey, manager) {
    const { payload, summary } = this.buildPayload(manager);
    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/variables`, {
      method: 'POST',
      headers: { 'X-Figma-Token': pat, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.err || `API error ${res.status}`);
    return { status: res.status, summary, response: data };
  }

  generateCurl(pat, fileKey, manager) {
    const { payload } = this.buildPayload(manager);
    const json = JSON.stringify(payload);
    const escaped = json.replace(/'/g, "'\\''");
    return `curl -X POST 'https://api.figma.com/v1/files/${fileKey}/variables' \\\n  -H 'X-Figma-Token: ${pat}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${escaped}'`;
  }

  // --- Persistence ---

  savePref(key, val) { try { localStorage.setItem(key, val); } catch(e) {} }
  loadPref(key) { try { return localStorage.getItem(key) || ''; } catch(e) { return ''; } }

  // --- UI ---

  renderPanel(container, manager) {
    this._container = container;
    this._manager = manager;
    this.state = this._initState();
    container.className = 'figma-api-panel';
    this._render();
  }

  _render() {
    const container = this._container;
    const manager = this._manager;
    const s = this.state;

    const fileKey = this.parseFileKey(s.fileUrl);
    const { summary } = this.buildPayload(manager);

    container.innerHTML = `
      <div class="fap-section">
        <div class="fap-section-title">${icon('key',13)} Connection</div>
        <div class="fap-field">
          <label class="fap-label">Personal Access Token</label>
          <div class="fap-input-row">
            <input type="password" class="fap-input fap-input-mono" id="fap-pat"
              placeholder="figd_..." value="${this._escHtml(s.pat)}" autocomplete="off" spellcheck="false">
            <button class="btn btn-ghost btn-icon-only fap-toggle-vis" data-target="fap-pat" title="Show/hide">
              ${icon('eye',14)}
            </button>
          </div>
          <div class="fap-hint">
            <label class="fap-checkbox-label">
              <input type="checkbox" id="fap-remember" ${s.pat ? 'checked' : ''}>
              Remember token
            </label>
            <span class="fap-hint-sep">·</span>
            <a href="https://www.figma.com/developers/api#access-tokens" target="_blank" rel="noopener" class="fap-link">
              How to create a token ↗
            </a>
          </div>
          <div class="fap-hint" style="margin-top:2px; opacity:0.65">
            Requires <code>file_variables:write</code> scope
          </div>
        </div>
        <div class="fap-field">
          <label class="fap-label">Figma file URL or key</label>
          <div class="fap-input-row">
            <input type="text" class="fap-input" id="fap-file"
              placeholder="https://figma.com/design/abc123/... or abc123"
              value="${this._escHtml(s.fileUrl)}" spellcheck="false">
            <button class="btn btn-secondary btn-sm" id="fap-load" ${s.loading ? 'disabled' : ''}>
              ${s.loading ? icon('spinner',13) + ' Loading…' : icon('arrow-clockwise',13) + ' Load'}
            </button>
          </div>
          <div class="fap-hint fap-file-key-preview" id="fap-file-preview">${
            fileKey ? `File key: ${this._escHtml(fileKey)}` : (s.fileUrl.trim() ? 'Could not extract file key' : '')
          }</div>
          ${s.loadError ? `<div class="fap-hint" style="color:var(--danger)">${this._escHtml(s.loadError)}</div>` : ''}
        </div>
      </div>

      <div class="fap-section">
        <div class="fap-section-title">${icon('folders',13)} Collection</div>
        ${this._renderCollectionSection()}
      </div>

      ${s.targetCollection ? this._renderMappingSection(manager) : ''}

      <div class="fap-section fap-summary">
        <div class="fap-summary-line">
          ${summary.activeScales.length} ${summary.activeScales.length === 1 ? 'scale' : 'scales'} →
          ${summary.updateCount > 0 ? `<span class="fap-summary-count">${summary.updateCount}</span> UPDATE` : ''}
          ${summary.updateCount > 0 && summary.createCount > 0 ? ', ' : ''}
          ${summary.createCount > 0 ? `<span class="fap-summary-count">${summary.createCount}</span> CREATE` : ''}
          ${summary.updateCount === 0 && summary.createCount === 0 ? '<span class="fap-summary-dim">no variables</span>' : ''}
        </div>
        ${summary.activeScales.length > 0 ? `
          <div class="fap-scales-list">
            ${summary.activeScales.map(n => `<span class="fap-scale-chip">${this._escHtml(n)}</span>`).join('')}
          </div>` : ''}
      </div>

      <div class="fap-actions">
        <button class="btn btn-secondary fap-curl-btn" id="fap-curl" title="Copy as curl command">
          ${icon('terminal',14)} Copy curl
        </button>
        <button class="btn btn-primary fap-push-btn" id="fap-push">
          ${icon('cloud-arrow-up',15)} Push to Figma
        </button>
      </div>
      <div class="fap-status" id="fap-status"></div>
    `;

    this._bindEvents();
  }

  _renderCollectionSection() {
    const s = this.state;
    if (s.loadedCollections === null) {
      // Not loaded yet — just show the create-new name input
      return `
        <div class="fap-field">
          <label class="fap-label">Collection name</label>
          <input type="text" class="fap-input" id="fap-collection" value="${this._escHtml(s.collectionName)}">
          <div class="fap-hint">Click <strong>Load</strong> above to fetch existing collections from the file.</div>
        </div>
      `;
    }
    // Loaded — radio-style picker
    const newIsActive = s.targetCollection === null;
    return `
      <div class="fap-field">
        <div class="fap-collections-list">
          <button class="fap-collection-item ${newIsActive ? 'active' : ''}" data-col-id="__new__">
            <span class="fap-col-radio"></span>
            <span class="fap-col-info">
              <span class="fap-col-name">Create new</span>
              <span class="fap-col-meta">${s.loadedCollections.length === 0 ? 'No existing collections found' : ''}</span>
            </span>
          </button>
          ${s.loadedCollections.map(c => {
            const active = s.targetCollection?.id === c.id;
            const modeStr = c.modes.length > 1
              ? `${c.modes.length} modes (${c.modes.map(m => this._escHtml(m.name)).join(', ')})`
              : '1 mode';
            return `
              <button class="fap-collection-item ${active ? 'active' : ''}" data-col-id="${this._escHtml(c.id)}">
                <span class="fap-col-radio"></span>
                <span class="fap-col-info">
                  <span class="fap-col-name">${this._escHtml(c.name)}</span>
                  <span class="fap-col-meta">${c.variableCount} variables · ${modeStr}</span>
                </span>
              </button>
            `;
          }).join('')}
        </div>
        ${newIsActive ? `
          <div class="fap-input-row" style="margin-block-start:8px">
            <input type="text" class="fap-input" id="fap-collection" value="${this._escHtml(s.collectionName)}" placeholder="New collection name">
          </div>
        ` : ''}
      </div>
    `;
  }

  _renderMappingSection(manager) {
    const s = this.state;
    const analysis = s.collectionAnalysis;
    if (!analysis) return '';

    const figmaSteps = [...analysis.allSteps].sort((a, b) => a - b);
    const localSteps = manager.stepLabels;
    const mismatch = figmaSteps.length > 0 && !this._stepsEqual(figmaSteps, localSteps);

    const prefixOptions = Object.keys(analysis.prefixes);

    return `
      <div class="fap-section">
        <div class="fap-section-title">${icon('sliders-horizontal',13)} Mapping</div>
        ${mismatch ? `
          <div class="fap-mismatch-notice">
            ${icon('warning',13)}
            <div class="fap-mismatch-text">
              <div>Collection has steps <code>${figmaSteps.slice(0,6).join(',')}${figmaSteps.length > 6 ? '…' : ''}</code> (${figmaSteps.length}) — ChromaScale has ${localSteps.length} steps.</div>
              <div style="margin-block-start:6px">
                <label class="fap-label" style="display:inline; margin-inline-end:6px">Strategy:</label>
                <select class="field fap-strategy-select" id="fap-strategy">
                  <option value="existing-only" ${s.stepStrategy === 'existing-only' ? 'selected' : ''}>Update existing steps only</option>
                  <option value="add-missing" ${s.stepStrategy === 'add-missing' ? 'selected' : ''}>Add missing steps</option>
                </select>
              </div>
            </div>
          </div>` : ''}
        <div class="fap-mapping-table">
          <div class="fap-mapping-header">
            <span>Local</span><span></span><span>Figma</span><span></span>
          </div>
          ${manager.scales.map(scale => {
            const sel = s.scaleMapping[scale.name] || 'skip';
            const figmaMatch = analysis.prefixes[sel];
            return `
              <div class="fap-mapping-row">
                <span class="fap-local-name">${this._escHtml(scale.name)}</span>
                <span class="fap-mapping-arrow">→</span>
                <select class="field fap-mapping-select" data-scale="${this._escHtml(scale.name)}">
                  <option value="skip" ${sel === 'skip' ? 'selected' : ''}>(skip)</option>
                  <option value="new" ${sel === 'new' ? 'selected' : ''}>+ create new</option>
                  ${prefixOptions.map(p =>
                    `<option value="${this._escHtml(p)}" ${sel === p ? 'selected' : ''}>${this._escHtml(p)}</option>`
                  ).join('')}
                </select>
                <span class="fap-mapping-meta">${figmaMatch ? `${figmaMatch.steps.length} vars` : ''}</span>
              </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  _bindEvents() {
    const container = this._container;
    const manager = this._manager;
    const s = this.state;

    // PAT — targeted update (no full render to preserve focus)
    const patInput = container.querySelector('#fap-pat');
    patInput.addEventListener('input', () => { s.pat = patInput.value; });

    // Toggle PAT visibility
    container.querySelector('.fap-toggle-vis').addEventListener('click', () => {
      const toggleBtn = container.querySelector('.fap-toggle-vis');
      if (patInput.type === 'password') {
        patInput.type = 'text';
        toggleBtn.innerHTML = icon('eye-slash',14);
      } else {
        patInput.type = 'password';
        toggleBtn.innerHTML = icon('eye',14);
      }
    });

    // File URL — targeted update + persist on blur
    const fileInput = container.querySelector('#fap-file');
    const filePreview = container.querySelector('#fap-file-preview');
    fileInput.addEventListener('input', () => {
      s.fileUrl = fileInput.value;
      const key = this.parseFileKey(s.fileUrl);
      filePreview.textContent = key ? `File key: ${key}` : (s.fileUrl.trim() ? 'Could not extract file key' : '');
      filePreview.style.color = key ? '' : 'var(--danger)';
    });
    fileInput.addEventListener('blur', () => this.savePref(this.STORAGE_KEY_FILE, s.fileUrl));

    // Load button — fetch collections + variables
    const loadBtn = container.querySelector('#fap-load');
    loadBtn.addEventListener('click', async () => {
      const pat = s.pat.trim();
      const fileKey = this.parseFileKey(s.fileUrl);
      if (!pat || !fileKey) {
        s.loadError = 'Enter token and file URL first';
        this._render();
        return;
      }
      s.loading = true;
      s.loadError = '';
      this._render();
      const spinner = container.querySelector('#fap-load svg');
      if (spinner) spinner.style.animation = 'spin 1s linear infinite';
      try {
        const { collections, variables } = await this.fetchFile(pat, fileKey);
        s.loadedCollections = collections;
        s.allVariables = variables;
        // Reset target when reloading
        s.targetCollection = null;
        s.collectionAnalysis = null;
        s.scaleMapping = {};
      } catch (e) {
        s.loadedCollections = null;
        const msg = e.message || String(e);
        s.loadError = msg.includes('Failed to fetch') || msg.includes('CORS')
          ? 'CORS blocked — try running over HTTP instead of file://'
          : msg;
      }
      s.loading = false;
      this._render();
    });

    // Collection picker
    container.querySelectorAll('.fap-collection-item').forEach(item => {
      item.addEventListener('click', () => {
        const colId = item.dataset.colId;
        if (colId === '__new__') {
          s.targetCollection = null;
          s.collectionAnalysis = null;
          s.scaleMapping = {};
        } else {
          s.targetCollection = s.loadedCollections.find(c => c.id === colId);
          s.collectionAnalysis = this.analyzeCollection(s.allVariables, colId);
          s.scaleMapping = this.autoMap(manager.scales, s.collectionAnalysis.prefixes);
        }
        this._render();
      });
    });

    // Collection name input (create-new mode)
    const colNameInput = container.querySelector('#fap-collection');
    if (colNameInput) {
      colNameInput.addEventListener('input', () => {
        s.collectionName = colNameInput.value;
      });
      colNameInput.addEventListener('blur', () => {
        this.savePref(this.STORAGE_KEY_COLLECTION, s.collectionName);
      });
    }

    // Mapping selects
    container.querySelectorAll('.fap-mapping-select').forEach(sel => {
      sel.addEventListener('change', () => {
        s.scaleMapping[sel.dataset.scale] = sel.value;
        this._render();
      });
    });

    // Step strategy select
    const strategySel = container.querySelector('#fap-strategy');
    if (strategySel) {
      strategySel.addEventListener('change', () => {
        s.stepStrategy = strategySel.value;
        this._render();
      });
    }

    // Push
    container.querySelector('#fap-push').addEventListener('click', async () => {
      const pat = s.pat.trim();
      const fileKey = this.parseFileKey(s.fileUrl);
      const remember = container.querySelector('#fap-remember').checked;
      const statusEl = container.querySelector('#fap-status');

      this.savePref(this.STORAGE_KEY_PAT, remember ? pat : '');
      this.savePref(this.STORAGE_KEY_FILE, s.fileUrl);
      if (!s.targetCollection) this.savePref(this.STORAGE_KEY_COLLECTION, s.collectionName);

      if (!pat) { this._showStatus(statusEl, 'error', 'Please enter your Personal Access Token'); return; }
      if (!fileKey) { this._showStatus(statusEl, 'error', 'Please enter a valid Figma file URL or key'); return; }

      const { summary: preSummary } = this.buildPayload(manager);
      if (preSummary.createCount + preSummary.updateCount === 0) {
        this._showStatus(statusEl, 'error', 'No variables to push — check your mapping or collection target');
        return;
      }

      const pushBtn = container.querySelector('#fap-push');
      pushBtn.disabled = true;
      pushBtn.innerHTML = icon('spinner',15) + ' Pushing…';
      const spinSvg = pushBtn.querySelector('svg');
      if (spinSvg) spinSvg.style.animation = 'spin 1s linear infinite';

      const targetDesc = s.targetCollection
        ? `"${s.targetCollection.name}"`
        : `new collection "${s.collectionName}"`;
      this._showStatus(statusEl, 'info', `Pushing ${preSummary.updateCount} updates + ${preSummary.createCount} creates to ${targetDesc}…`);

      try {
        const result = await this.push(pat, fileKey, manager);
        pushBtn.innerHTML = icon('check',15) + ' Done!';
        const { createCount, updateCount } = result.summary;
        this._showStatus(statusEl, 'success',
          `✓ ${updateCount} updated, ${createCount} created in ${targetDesc}. ` +
          `<a href="https://www.figma.com/design/${fileKey}" target="_blank" rel="noopener">Open file ↗</a>`
        );
      } catch (err) {
        pushBtn.disabled = false;
        pushBtn.innerHTML = icon('cloud-arrow-up',15) + ' Push to Figma';
        const msg = err.message || String(err);
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
          this._showStatus(statusEl, 'error',
            'Network error — likely a CORS restriction when running from file://. ' +
            'Use <strong>Copy curl</strong> and run it in your terminal instead.'
          );
        } else {
          this._showStatus(statusEl, 'error', `Error: ${this._escHtml(msg)}`);
        }
      }
    });

    // Curl
    container.querySelector('#fap-curl').addEventListener('click', () => {
      const pat = s.pat.trim() || '<YOUR_PAT>';
      const fileKey = this.parseFileKey(s.fileUrl) || '<FILE_KEY>';
      const statusEl = container.querySelector('#fap-status');
      const curl = this.generateCurl(pat, fileKey, manager);
      navigator.clipboard.writeText(curl).then(() => {
        this._showStatus(statusEl, 'success', 'Curl command copied to clipboard. Paste it in your terminal.');
      }).catch(() => {
        this._showStatus(statusEl, 'info', `<pre class="fap-curl-output">${this._escHtml(curl)}</pre>`);
      });
    });
  }

  _showStatus(el, type, msg) {
    el.className = `fap-status fap-status-${type}`;
    el.innerHTML = msg;
    el.style.display = 'block';
  }

  _escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

// Global instance
window.figmaPusher = new FigmaPusher();
