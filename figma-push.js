// ChromaScale — Figma Push Module
// Pushes color variables to Figma via the Variables REST API

class FigmaPusher {
  constructor() {
    this.STORAGE_KEY_PAT = 'chromascale-figma-pat';
    this.STORAGE_KEY_FILE = 'chromascale-figma-file';
    this.STORAGE_KEY_COLLECTION = 'chromascale-figma-collection';
    this.STORAGE_KEY_STEPS = 'chromascale-figma-steps';

    // Step presets
    this.MAJOR_STEPS = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900];
    this.ALL_STEPS = [
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
      150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750,
      800, 810, 820, 830, 840, 850, 860, 870, 880, 890, 900
    ];
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

  // Build the API payload for creating variables
  buildPayload(scales, selectedSteps, collectionName) {
    const colId = 'tmp_col_' + Date.now();
    const modeId = 'tmp_mode_default';

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

        // Try to use pre-generated steps first, fall back to sampling
        const existing = scale.steps.find(s => s.label === stepLabel);
        const hex = existing ? existing.hex : scale.sampleStep(stepLabel).hex;

        modeValues.push({
          variableId: varId,
          modeId: modeId,
          value: this.hexToFigmaColor(hex)
        });
      });
    });

    return {
      variableCollections: [{
        action: 'CREATE',
        id: colId,
        name: collectionName || 'Colors',
        initialModeId: modeId
      }],
      variableModes: [
        { action: 'UPDATE', id: modeId, name: 'Default', variableCollectionId: colId }
      ],
      variables,
      variableModeValues: modeValues
    };
  }

  // Push to Figma API
  async push(pat, fileKey, scales, selectedSteps, collectionName) {
    const payload = this.buildPayload(scales, selectedSteps, collectionName);

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
  generateCurl(pat, fileKey, scales, selectedSteps, collectionName) {
    const payload = this.buildPayload(scales, selectedSteps, collectionName);
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

    // State
    let stepPreset = savedStepsPref;
    let selectedSteps = stepPreset === 'all' ? [...this.ALL_STEPS] : [...this.MAJOR_STEPS];
    let customSteps = [...this.ALL_STEPS]; // for custom mode, start with all

    if (savedStepsPref === 'custom') {
      try {
        const parsed = JSON.parse(this.loadPref(this.STORAGE_KEY_STEPS + '-list'));
        if (Array.isArray(parsed)) { customSteps = parsed; selectedSteps = parsed; }
      } catch(e) {}
    }

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
          <div class="fap-field">
            <label class="fap-label">Collection name</label>
            <input type="text" class="fap-input" id="fap-collection" value="${this._escHtml(savedCollection)}">
          </div>
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
            <button class="btn ${stepPreset === 'major' ? 'btn-primary' : 'btn-secondary'} fap-preset-btn" data-preset="major">
              Major (${this.MAJOR_STEPS.length})
            </button>
            <button class="btn ${stepPreset === 'all' ? 'btn-primary' : 'btn-secondary'} fap-preset-btn" data-preset="all">
              All (${this.ALL_STEPS.length})
            </button>
            <button class="btn ${stepPreset === 'custom' ? 'btn-primary' : 'btn-secondary'} fap-preset-btn" data-preset="custom">
              Custom
            </button>
          </div>
          ${stepPreset === 'custom' ? this._renderStepPicker(customSteps) : ''}
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
          if (stepPreset === 'major') selectedSteps = [...this.MAJOR_STEPS];
          else if (stepPreset === 'all') selectedSteps = [...this.ALL_STEPS];
          else selectedSteps = [...customSteps];
          this.savePref(this.STORAGE_KEY_STEPS, stepPreset);
          render();
        });
      });

      // Custom step toggles
      if (stepPreset === 'custom') {
        container.querySelectorAll('.fap-step-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            const step = parseInt(chip.dataset.step);
            const idx = customSteps.indexOf(step);
            if (idx >= 0) customSteps.splice(idx, 1);
            else { customSteps.push(step); customSteps.sort((a, b) => a - b); }
            selectedSteps = [...customSteps];
            this.savePref(this.STORAGE_KEY_STEPS + '-list', JSON.stringify(customSteps));
            render();
          });
        });

        // Add custom step
        const addBtn = container.querySelector('#fap-add-custom-step');
        const addInput = container.querySelector('#fap-custom-step-input');
        if (addBtn && addInput) {
          const doAdd = () => {
            const val = parseInt(addInput.value);
            if (isNaN(val) || val < 0 || val > 900) return;
            if (!customSteps.includes(val)) {
              customSteps.push(val);
              customSteps.sort((a, b) => a - b);
              selectedSteps = [...customSteps];
              this.savePref(this.STORAGE_KEY_STEPS + '-list', JSON.stringify(customSteps));
            }
            addInput.value = '';
            render();
          };
          addBtn.addEventListener('click', doAdd);
          addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
        }
      }

      // Push button
      container.querySelector('#fap-push').addEventListener('click', async () => {
        const pat = container.querySelector('#fap-pat').value.trim();
        const fileRaw = container.querySelector('#fap-file').value.trim();
        const fileKey = this.parseFileKey(fileRaw);
        const collection = container.querySelector('#fap-collection').value.trim() || 'Colors';
        const remember = container.querySelector('#fap-remember').checked;

        // Save preferences
        this.savePref(this.STORAGE_KEY_PAT, remember ? pat : '');
        this.savePref(this.STORAGE_KEY_FILE, fileRaw);
        this.savePref(this.STORAGE_KEY_COLLECTION, collection);

        const statusEl = container.querySelector('#fap-status');

        if (!pat) { this._showStatus(statusEl, 'error', 'Please enter your Personal Access Token'); return; }
        if (!fileKey) { this._showStatus(statusEl, 'error', 'Please enter a valid Figma file URL or key'); return; }
        if (selectedSteps.length === 0) { this._showStatus(statusEl, 'error', 'Select at least one step'); return; }

        const pushBtn = container.querySelector('#fap-push');
        pushBtn.disabled = true;
        pushBtn.innerHTML = icon('spinner',15) + ' Pushing…';
          pushBtn.querySelector('svg').style.animation = 'spin 1s linear infinite';
        this._showStatus(statusEl, 'info', `Creating ${manager.scales.length * selectedSteps.length} variables in "${collection}"…`);

        try {
          const result = await this.push(pat, fileKey, manager.scales, selectedSteps, collection);
          pushBtn.innerHTML = icon('check',15) + ' Done!';
          this._showStatus(statusEl, 'success',
            `✓ Created ${result.variablesCreated} variables in "${collection}". ` +
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
        const collection = container.querySelector('#fap-collection').value.trim() || 'Colors';
        const statusEl = container.querySelector('#fap-status');

        const curl = this.generateCurl(pat, fileKey, manager.scales, selectedSteps, collection);
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

  _renderStepPicker(customSteps) {
    // All possible steps we show as toggleable chips
    const allPossible = [
      0, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100,
      125, 150, 175, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750,
      800, 810, 820, 825, 830, 840, 850, 860, 870, 875, 880, 890, 900
    ];
    // Merge any custom steps into the list
    const merged = [...new Set([...allPossible, ...customSteps])].sort((a, b) => a - b);

    return `
      <div class="fap-step-picker">
        <div class="fap-step-chips">
          ${merged.map(s => {
            const active = customSteps.includes(s);
            const isMajor = this.MAJOR_STEPS.includes(s);
            return `<button class="fap-step-chip ${active ? 'active' : ''} ${isMajor ? 'major' : ''}" data-step="${s}">${s}</button>`;
          }).join('')}
        </div>
        <div class="fap-add-step-row">
          <input type="number" class="fap-input fap-input-sm" id="fap-custom-step-input" 
            placeholder="Custom step (0–900)" min="0" max="900" step="1">
          <button class="btn btn-secondary btn-sm" id="fap-add-custom-step">Add</button>
        </div>
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
