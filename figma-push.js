// ChromaScale — Figma Push Module
// Pushes color variables to Figma via the Variables REST API

class FigmaPusher {
  constructor() {
    this.STORAGE_KEY_PAT = 'chromascale-figma-pat';
    this.STORAGE_KEY_FILE = 'chromascale-figma-file';
    this.STORAGE_KEY_COLLECTION = 'chromascale-figma-collection';
    this.STORAGE_KEY_STEPS = 'chromascale-figma-steps';

  }

  // Step presets sourced from the live manager (respects per-set step config)
  _majorSteps(mgr) { return mgr.majorSteps(); }
  _allSteps(mgr) { return [...mgr.stepLabels]; }

  // Fetch existing variable collections from the file.
  // Returns [{ id, name, modes: [{modeId, name}], variableCount, defaultModeId }]
  // Throws on network/auth errors with a useful message.
  async fetchCollections(pat, fileKey) {
    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/variables/local`, {
      headers: { 'X-Figma-Token': pat }
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Figma API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const collections = data.meta?.variableCollections || {};
    return Object.values(collections)
      .filter(c => !c.remote) // only local (editable) collections
      .map(c => ({
        id: c.id,
        name: c.name,
        modes: c.modes || [],
        defaultModeId: c.defaultModeId,
        variableCount: (c.variableIds || []).length
      }));
  }

  // Extract file key from URL or raw key
  parseFileKey(input) {
    if (!input) return null;
    input = input.trim();
    // Match figma.com/design/{key}/... or figma.com/file/{key}/...
    const urlMatch = input.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
    if (urlMatch) return urlMatch[1];
    // Raw key (alphanumeric, typically 20+ chars)
    if (/^[a-zA-Z0-9]{10,}$/.test(input)) return input;
    return null;
  }

  // Convert hex to Figma RGBA (0–1 range)
  hexToFigmaColor(hex) {
    const rgb = ColorEngine.hexToRgb(hex);
    return { r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255, a: 1 };
  }

  // Build the API payload for creating variables.
  // If existingCollection is passed ({id, defaultModeId}), variables are
  // CREATEd into that collection using its real id + default mode id.
  // Otherwise a fresh collection is CREATEd with a temp id.
  buildPayload(scales, selectedSteps, collectionName, existingCollection = null) {
    const useExisting = !!existingCollection;
    const colId = useExisting ? existingCollection.id : 'tmp_col_' + Date.now();
    const modeId = useExisting ? existingCollection.defaultModeId : 'tmp_mode_default';

    const variables = [];
    const modeValues = [];

    scales.forEach(scale => {
      const prefix = scale.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

      selectedSteps.forEach(stepLabel => {
        const varId = `tmp_${prefix}_${stepLabel}`;
        const varName = `${prefix}/${stepLabel}`;

        variables.push({
          action: 'CREATE',
          id: varId,
          name: varName,
          variableCollectionId: colId,
          resolvedType: 'COLOR'
        });

        const existing = scale.steps.find(s => s.label === stepLabel);
        const hex = existing ? existing.hex : scale.sampleStep(stepLabel).hex;

        modeValues.push({
          variableId: varId,
          modeId: modeId,
          value: this.hexToFigmaColor(hex)
        });
      });
    });

    const payload = {
      variables,
      variableModeValues: modeValues
    };

    if (useExisting) {
      // Just add variables into the existing collection; no collection/mode ops
      payload.variableCollections = [];
      payload.variableModes = [];
    } else {
      payload.variableCollections = [{
        action: 'CREATE',
        id: colId,
        name: collectionName || 'Colors',
        initialModeId: modeId
      }];
      payload.variableModes = [
        { action: 'UPDATE', id: modeId, name: 'Default', variableCollectionId: colId }
      ];
    }

    return payload;
  }

  // Push to Figma API
  async push(pat, fileKey, scales, selectedSteps, collectionName, existingCollection = null) {
    const payload = this.buildPayload(scales, selectedSteps, collectionName, existingCollection);

    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/variables`, {
      method: 'POST',
      headers: {
        'X-Figma-Token': pat,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || data.err || `API error ${res.status}`);
    }

    return {
      status: res.status,
      variablesCreated: payload.variables.length,
      collection: collectionName,
      response: data
    };
  }

  // Generate a curl command as fallback
  generateCurl(pat, fileKey, scales, selectedSteps, collectionName, existingCollection = null) {
    const payload = this.buildPayload(scales, selectedSteps, collectionName, existingCollection);
    const json = JSON.stringify(payload);
    // Escape single quotes for shell
    const escaped = json.replace(/'/g, "'\\''");
    return `curl -X POST 'https://api.figma.com/v1/files/${fileKey}/variables' \\\n  -H 'X-Figma-Token: ${pat}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${escaped}'`;
  }

  // Save/load preferences
  savePref(key, val) { try { localStorage.setItem(key, val); } catch(e) {} }
  loadPref(key) { try { return localStorage.getItem(key) || ''; } catch(e) { return ''; } }

  // Render the Figma API panel inside an export modal section
  renderPanel(container, manager) {
    const savedPat = this.loadPref(this.STORAGE_KEY_PAT);
    const savedFile = this.loadPref(this.STORAGE_KEY_FILE);
    const savedCollection = this.loadPref(this.STORAGE_KEY_COLLECTION) || 'Colors';
    const savedStepsPref = this.loadPref(this.STORAGE_KEY_STEPS) || 'major';

    container.innerHTML = '';
    container.className = 'figma-api-panel';

    // Step presets from the live manager (respects per-set step config)
    const MAJOR = this._majorSteps(manager);
    const ALL = this._allSteps(manager);

    // State
    let stepPreset = savedStepsPref;
    // Migrate: old chip-picker saved JSON.stringify(array) → "[0,50,...]".
    // Strip brackets if present so parsing works with the new plain-text format.
    let customStepsText = (this.loadPref(this.STORAGE_KEY_STEPS + '-list') || ALL.join(', '))
      .replace(/^\s*\[|\]\s*$/g, '');
    let selectedSteps;
    let stepError = '';

    // Collection state: null = create new with name input; object = target existing
    let loadedCollections = null;  // null = not loaded yet; [] = loaded, empty; [...] = loaded
    let targetCollection = null;   // {id, name, defaultModeId, variableCount} when using existing
    let collectionLoadError = '';

    // Parse step selection from current preset + validate custom text
    const resolveSteps = () => {
      stepError = '';
      if (stepPreset === 'major') return [...MAJOR];
      if (stepPreset === 'all') return [...ALL];
      // custom — parse the textarea (same validator as settings popover)
      try {
        // For Figma export we don't need the 0/900 endpoint rule — any subset
        // is valid. So parse manually: ints 0–900, sorted/deduped.
        const raw = customStepsText.split(/[,\s]+/).filter(Boolean);
        if (raw.length === 0) throw new Error('No steps');
        const nums = raw.map(s => {
          const n = Number(s);
          if (!Number.isInteger(n) || n < 0 || n > 900) {
            throw new Error(`Invalid step "${s}"`);
          }
          return n;
        });
        return [...new Set(nums)].sort((a, b) => a - b);
      } catch (e) {
        stepError = e.message;
        return [];
      }
    };
    selectedSteps = resolveSteps();

    const render = () => {
      const scaleCount = manager.scales.length;
      const varCount = scaleCount * selectedSteps.length;

      container.innerHTML = `
        <div class="fap-section">
          <div class="fap-section-title">
            ${icon('key',13)}
            Connection
          </div>
          <div class="fap-field">
            <label class="fap-label">Personal Access Token</label>
            <div class="fap-input-row">
              <input type="password" class="fap-input fap-input-mono" id="fap-pat" 
                placeholder="figd_..." value="${this._escHtml(savedPat)}" autocomplete="off" spellcheck="false">
              <button class="btn btn-ghost btn-icon-only fap-toggle-vis" data-target="fap-pat" title="Show/hide">
                ${icon('eye',14)}
              </button>
            </div>
            <div class="fap-hint">
              <label class="fap-checkbox-label">
                <input type="checkbox" id="fap-remember" ${savedPat ? 'checked' : ''}>
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
            <input type="text" class="fap-input" id="fap-file" 
              placeholder="https://figma.com/design/abc123/... or abc123" 
              value="${this._escHtml(savedFile)}" spellcheck="false">
            <div class="fap-hint fap-file-key-preview" id="fap-file-preview"></div>
          </div>
        </div>

        <div class="fap-section">
          <div class="fap-section-title">
            ${icon('folders',13)}
            Collection
          </div>
          ${this._renderCollectionSection(savedCollection, loadedCollections, targetCollection, collectionLoadError)}
          <div class="fap-field">
            <label class="fap-label">Variable naming</label>
            <div class="fap-naming-preview">
              ${manager.scales.slice(0, 3).map(s => {
                const p = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
                return `<code>${p}/0</code> <code>${p}/500</code> <code>${p}/900</code>`;
              }).join(' ')}
              ${manager.scales.length > 3 ? '<span class="fap-hint">…</span>' : ''}
            </div>
          </div>
        </div>

        <div class="fap-section">
          <div class="fap-section-title">
            ${icon('sliders-horizontal',13)}
            Steps
          </div>
          <div class="fap-step-presets">
            <button class="btn btn-sm ${stepPreset === 'major' ? 'btn-primary' : 'btn-secondary'} fap-preset-btn" data-preset="major">
              Major (${MAJOR.length})
            </button>
            <button class="btn btn-sm ${stepPreset === 'all' ? 'btn-primary' : 'btn-secondary'} fap-preset-btn" data-preset="all">
              All (${ALL.length})
            </button>
            <button class="btn btn-sm ${stepPreset === 'custom' ? 'btn-primary' : 'btn-secondary'} fap-preset-btn" data-preset="custom">
              Custom
            </button>
          </div>
          <textarea class="field field-mono fap-steps-textarea" id="fap-custom-steps" rows="3"
            spellcheck="false" ${stepPreset !== 'custom' ? 'readonly' : ''}
            placeholder="0, 50, 100, 200, …">${this._escHtml(
              stepPreset === 'custom' ? customStepsText : selectedSteps.join(', ')
            )}</textarea>
          ${stepError ? `<div class="fap-step-error">${this._escHtml(stepError)}</div>` : ''}
        </div>

        <div class="fap-section fap-summary">
          <div class="fap-summary-line">
            <span class="fap-summary-count">${scaleCount}</span> scales ×
            <span class="fap-summary-count">${selectedSteps.length}</span> steps =
            <span class="fap-summary-count">${varCount}</span> variables
          </div>
          <div class="fap-scales-list">
            ${manager.scales.map(s => `<span class="fap-scale-chip">${this._escHtml(s.name)}</span>`).join('')}
          </div>
        </div>

        <div class="fap-actions">
          <button class="btn btn-primary fap-push-btn" id="fap-push">
            ${icon('cloud-arrow-up',15)}
            Push to Figma
          </button>
          <button class="btn btn-secondary fap-curl-btn" id="fap-curl" title="Copy as curl command">
            ${icon('terminal',14)}
            Copy curl
          </button>
        </div>
        <div class="fap-status" id="fap-status"></div>
      `;

      // --- Bind events ---

      // Toggle password visibility
      container.querySelector('.fap-toggle-vis').addEventListener('click', () => {
        const inp = container.querySelector('#fap-pat');
        const toggleBtn = container.querySelector('.fap-toggle-vis');
        if (inp.type === 'password') {
          inp.type = 'text';
          toggleBtn.innerHTML = icon('eye-slash',14);
        } else {
          inp.type = 'password';
          toggleBtn.innerHTML = icon('eye',14);
        }
      });

      // File key preview
      const fileInput = container.querySelector('#fap-file');
      const filePreview = container.querySelector('#fap-file-preview');
      const updateFilePreview = () => {
        const key = this.parseFileKey(fileInput.value);
        filePreview.textContent = key ? `File key: ${key}` : (fileInput.value.trim() ? 'Could not extract file key' : '');
        filePreview.style.color = key ? '' : 'var(--color-red-500, #a63244)';
      };
      fileInput.addEventListener('input', updateFilePreview);
      updateFilePreview();

      // Step presets
      container.querySelectorAll('.fap-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          stepPreset = btn.dataset.preset;
          this.savePref(this.STORAGE_KEY_STEPS, stepPreset);
          selectedSteps = resolveSteps();
          render();
        });
      });

      // Custom steps textarea — live-validate, save on input.
      // Textarea is always rendered now (readonly for presets) but only
      // editable + persisted in custom mode.
      const ta = container.querySelector('#fap-custom-steps');
      if (stepPreset === 'custom') {
        ta.addEventListener('input', () => {
          customStepsText = ta.value;
          this.savePref(this.STORAGE_KEY_STEPS + '-list', customStepsText);
          selectedSteps = resolveSteps();
          // Update just the error + summary without a full re-render to keep focus
          const errEl = container.querySelector('.fap-step-error');
          if (stepError) {
            if (errEl) errEl.textContent = stepError;
            else ta.insertAdjacentHTML('afterend', `<div class="fap-step-error">${this._escHtml(stepError)}</div>`);
          } else if (errEl) {
            errEl.remove();
          }
          const countEls = container.querySelectorAll('.fap-summary-count');
          if (countEls.length >= 3) {
            countEls[1].textContent = selectedSteps.length;
            countEls[2].textContent = manager.scales.length * selectedSteps.length;
          }
        });
      } else {
        // Clicking the readonly textarea when on a preset switches to custom
        // pre-filled with that preset's values — quick path from preset→edit.
        ta.addEventListener('click', () => {
          customStepsText = selectedSteps.join(', ');
          stepPreset = 'custom';
          this.savePref(this.STORAGE_KEY_STEPS, 'custom');
          this.savePref(this.STORAGE_KEY_STEPS + '-list', customStepsText);
          render();
        });
      }

      // Collection: load existing collections
      const loadBtn = container.querySelector('#fap-load-collections');
      if (loadBtn) {
        loadBtn.addEventListener('click', async () => {
          const pat = container.querySelector('#fap-pat').value.trim();
          const fileKey = this.parseFileKey(container.querySelector('#fap-file').value);
          if (!pat || !fileKey) {
            collectionLoadError = 'Enter token and file URL first';
            render();
            return;
          }
          loadBtn.disabled = true;
          loadBtn.innerHTML = icon('spinner',13) + ' Loading…';
          loadBtn.querySelector('svg').style.animation = 'spin 1s linear infinite';
          collectionLoadError = '';
          try {
            loadedCollections = await this.fetchCollections(pat, fileKey);
          } catch (e) {
            loadedCollections = null;
            const msg = e.message || String(e);
            collectionLoadError = msg.includes('Failed to fetch') || msg.includes('CORS')
              ? 'CORS blocked — try running this over HTTP instead of file://'
              : msg;
          }
          render();
        });
      }

      // Collection: pick an existing one
      container.querySelectorAll('.fap-collection-item').forEach(item => {
        item.addEventListener('click', () => {
          const colId = item.dataset.colId;
          if (colId === '__new__') {
            targetCollection = null;
          } else {
            targetCollection = loadedCollections.find(c => c.id === colId);
          }
          render();
        });
      });

      // Push button
      container.querySelector('#fap-push').addEventListener('click', async () => {
        const pat = container.querySelector('#fap-pat').value.trim();
        const fileRaw = container.querySelector('#fap-file').value.trim();
        const fileKey = this.parseFileKey(fileRaw);
        // #fap-collection is absent when targeting an existing collection
        const collectionInput = container.querySelector('#fap-collection');
        const collection = collectionInput ? (collectionInput.value.trim() || 'Colors') : 'Colors';
        const remember = container.querySelector('#fap-remember').checked;

        // Save preferences
        this.savePref(this.STORAGE_KEY_PAT, remember ? pat : '');
        this.savePref(this.STORAGE_KEY_FILE, fileRaw);
        if (collectionInput) this.savePref(this.STORAGE_KEY_COLLECTION, collection);

        const statusEl = container.querySelector('#fap-status');

        if (!pat) { this._showStatus(statusEl, 'error', 'Please enter your Personal Access Token'); return; }
        if (!fileKey) { this._showStatus(statusEl, 'error', 'Please enter a valid Figma file URL or key'); return; }
        if (selectedSteps.length === 0) { this._showStatus(statusEl, 'error', 'Select at least one step'); return; }

        const pushBtn = container.querySelector('#fap-push');
        pushBtn.disabled = true;
        pushBtn.innerHTML = icon('spinner',15) + ' Pushing…';
          pushBtn.querySelector('svg').style.animation = 'spin 1s linear infinite';
        const targetDesc = targetCollection ? `existing collection "${targetCollection.name}"` : `new collection "${collection}"`;
        this._showStatus(statusEl, 'info', `Creating ${manager.scales.length * selectedSteps.length} variables in ${targetDesc}…`);

        try {
          const result = await this.push(pat, fileKey, manager.scales, selectedSteps, collection, targetCollection);
          pushBtn.innerHTML = icon('check',15) + ' Done!';
          this._showStatus(statusEl, 'success',
            `✓ Created ${result.variablesCreated} variables in ${targetDesc}. ` +
            `<a href="https://www.figma.com/design/${fileKey}" target="_blank" rel="noopener">Open file ↗</a>`
          );
        } catch (err) {
          pushBtn.disabled = false;
          pushBtn.innerHTML = icon('cloud-arrow-up',15) + ' Push to Figma';
          const msg = err.message || String(err);
          if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS')) {
            this._showStatus(statusEl, 'error',
              'Network error — likely a CORS restriction in this preview environment. ' +
              'Use the <strong>Copy curl</strong> button and run it in your terminal instead.'
            );
          } else {
            this._showStatus(statusEl, 'error', `Error: ${this._escHtml(msg)}`);
          }
        }
      });

      // Curl fallback
      container.querySelector('#fap-curl').addEventListener('click', () => {
        const pat = container.querySelector('#fap-pat').value.trim() || '<YOUR_PAT>';
        const fileRaw = container.querySelector('#fap-file').value.trim();
        const fileKey = this.parseFileKey(fileRaw) || '<FILE_KEY>';
        const collectionInput = container.querySelector('#fap-collection');
        const collection = collectionInput ? (collectionInput.value.trim() || 'Colors') : 'Colors';
        const statusEl = container.querySelector('#fap-status');

        const curl = this.generateCurl(pat, fileKey, manager.scales, selectedSteps, collection, targetCollection);
        navigator.clipboard.writeText(curl).then(() => {
          this._showStatus(statusEl, 'success', 'Curl command copied to clipboard. Paste it in your terminal.');
        }).catch(() => {
          // Fallback: show in a textarea
          this._showStatus(statusEl, 'info', `<pre class="fap-curl-output">${this._escHtml(curl)}</pre>`);
        });
      });
    };

    render();
  }

  // Collection section markup — switches between:
  //   (a) not loaded: name input + "Load existing collections" button
  //   (b) loaded: radio-style list (existing collections + "Create new")
  _renderCollectionSection(savedName, loaded, target, error) {
    // Not-yet-loaded / error → simple text input + load button
    if (loaded === null) {
      return `
        <div class="fap-field">
          <label class="fap-label">Collection name</label>
          <div class="fap-input-row">
            <input type="text" class="fap-input" id="fap-collection" value="${this._escHtml(savedName)}">
            <button class="btn btn-secondary btn-sm" id="fap-load-collections" data-tooltip="Fetch collections from this file">
              ${icon('arrow-clockwise',13)} Load existing
            </button>
          </div>
          ${error ? `<div class="fap-hint" style="color:var(--danger)">${this._escHtml(error)}</div>` : ''}
        </div>
      `;
    }
    // Loaded → picker list. Existing collections first, "Create new" last
    // so it sits adjacent to the name input below.
    const newIsActive = target === null;
    return `
      <div class="fap-field">
        <label class="fap-label">Target collection</label>
        <div class="fap-collections-list">
          ${loaded.map(c => {
            const active = target?.id === c.id;
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
          <button class="fap-collection-item ${newIsActive ? 'active' : ''}" data-col-id="__new__">
            <span class="fap-col-radio"></span>
            <span class="fap-col-info">
              <span class="fap-col-name">Create new</span>
              <span class="fap-col-meta">${loaded.length === 0 ? 'No existing collections found' : ''}</span>
            </span>
          </button>
        </div>
        ${newIsActive ? `
          <div class="fap-input-row" style="margin-block-start:8px">
            <input type="text" class="fap-input" id="fap-collection" value="${this._escHtml(savedName)}" placeholder="New collection name">
            <button class="btn btn-secondary btn-sm" id="fap-load-collections" data-tooltip="Reload">
              ${icon('arrow-clockwise',13)}
            </button>
          </div>
        ` : `
          <div class="fap-hint" style="margin-block-start:8px">
            Variables will be <strong>added</strong> to "${this._escHtml(target.name)}" using its default mode.
            Existing variables are kept.
            <button class="btn btn-ghost btn-sm" id="fap-load-collections" style="padding:2px 6px">${icon('arrow-clockwise',11)} Reload</button>
          </div>
        `}
      </div>
    `;
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
