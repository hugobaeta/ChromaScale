// ChromaScale — Scale Manager v3
// 35-step scales with uniform linear lightness and contrast constraint enforcement

// Default step labels: 10s at ends, 50s in the middle
const DEFAULT_STEP_LABELS = [
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
  150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750,
  800, 810, 820, 830, 840, 850, 860, 870, 880, 890, 900
];

// Default divisor: any label divisible by this is "major"
const DEFAULT_MAJOR_DIVISOR = 50;

// Parse a comma/space-separated list of step labels, validate, and return
// a sorted unique array. Throws on invalid input.
// Rules: integers, ascending, must start at 0 and end at 900, at least 2 steps.
function parseStepLabels(input) {
  const raw = String(input).split(/[,\s]+/).filter(Boolean);
  if (raw.length === 0) throw new Error('No steps provided');
  const nums = raw.map(s => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0 || n > 900) {
      throw new Error(`Invalid step "${s}" (must be integer 0–900)`);
    }
    return n;
  });
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  if (uniq[0] !== 0) throw new Error('Steps must start at 0');
  if (uniq[uniq.length - 1] !== 900) throw new Error('Steps must end at 900');
  if (uniq.length < 2) throw new Error('Need at least 2 steps');
  return uniq;
}

// Contrast requirement for a given step gap
// Thresholds are the tightest gaps that achieve each WCAG level across the full
// hue wheel with the linear L schedule (verified against 426 saturated test colors).
// A = 3:1 (large text), AA = 4.5:1 (normal text), AAA = 7:1 (enhanced)
function getRequiredRatio(gap) {
  if (gap >= 600) return 7;    // AAA
  if (gap >= 500) return 4.5;  // AA
  if (gap >= 400) return 3;    // A
  return null;
}

// Approximate OKLCH L → relative luminance (exact for achromatic)
function approxLuminance(L) {
  return L * L * L; // Y ≈ L^3
}

// Approximate relative luminance → OKLCH L
function approxL(Y) {
  if (Y <= 0) return 0;
  return Math.cbrt(Y);
}

// Given a lighter luminance Y_light and a required contrast ratio,
// compute the maximum luminance the darker step can have
function maxDarkerLuminance(Y_light, ratio) {
  return (Y_light + 0.05) / ratio - 0.05;
}

// Given a darker luminance Y_dark and a required contrast ratio,
// compute the minimum luminance the lighter step must have
function minLighterLuminance(Y_dark, ratio) {
  return ratio * (Y_dark + 0.05) - 0.05;
}

class Scale {
  // keyHexOrArray: single hex string, or array of hex strings (full palette)
  // manager: reference to owning ScaleManager (for linear L schedule)
  constructor(name, keyHexOrArray, manager) {
    this.id = 'scale_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    this.name = name || 'Untitled';
    this.manager = manager || null;

    if (Array.isArray(keyHexOrArray)) {
      this.keyColors = [...keyHexOrArray];
    } else {
      this.keyColors = keyHexOrArray ? [keyHexOrArray] : ['#3B82F6'];
    }

    this.steps = [];
    this.curvePoints = { C: [], H: [] };
    this.outOfRangeCount = 0;       // how many key colors are beyond step 900
    this.outOfRangeIndices = [];     // which indices are out of range

    this._initCurves();
    this.generate();
  }

  _initCurves() {
    const lMax = this.manager ? this.manager.lightnessMax : 1.0;
    const lMin = this.manager ? this.manager.lightnessMin : 0.15;
    const lRange = lMax - lMin;
    const allOklch = this.keyColors.map(hex => ColorEngine.hexToOklch(hex));

    // Filter out colors that are darker than the 900 level (lightnessMin)
    // These are "out of range" — too dark to appear in the 0-900 scale
    this.outOfRangeIndices = [];
    const inRangeOklch = [];
    const inRangeIdx = [];

    allOklch.forEach((c, i) => {
      if (c.L < lMin - 0.005) {
        this.outOfRangeIndices.push(i);
      } else {
        inRangeOklch.push(c);
        inRangeIdx.push(i);
      }
    });

    this.outOfRangeCount = this.outOfRangeIndices.length;

    // Use only in-range colors for curve generation
    const oklchColors = inRangeOklch.length > 0 ? inRangeOklch : allOklch;
    const n = oklchColors.length;

    // Place each key color's C/H peak at the position in the linear L schedule
    // that matches its natural lightness — this maximizes achievable chroma
    // since gamut clamping is minimal when L matches the color's native value.
    function naturalPosition(L) {
      if (lRange <= 0) return 0.5;
      return Math.max(0.02, Math.min(0.98, (lMax - L) / lRange));
    }

    if (n === 1) {
      const c = oklchColors[0];
      const pos = naturalPosition(c.L);
      this.curvePoints = {
        C: [
          { x: 0, y: 0 },
          { x: pos, y: c.C },
          { x: 1, y: 0 }
        ],
        H: [
          { x: 0, y: c.H },
          { x: pos, y: c.H },
          { x: 1, y: c.H }
        ]
      };
    } else {
      const cPoints = [{ x: 0, y: 0 }];
      const hPoints = [{ x: 0, y: oklchColors[0].H }];

      oklchColors.forEach((c) => {
        const pos = naturalPosition(c.L);
        cPoints.push({ x: pos, y: c.C });
        hPoints.push({ x: pos, y: c.H });
      });

      cPoints.push({ x: 1, y: 0 });
      hPoints.push({ x: 1, y: oklchColors[n - 1].H });

      // Ensure ascending x order (key colors are sorted by L descending → pos ascending)
      cPoints.sort((a, b) => a.x - b.x);
      hPoints.sort((a, b) => a.x - b.x);

      this.curvePoints = { C: cPoints, H: hPoints };
    }
  }

  addKeyColor(hex) {
    const oklch = ColorEngine.hexToOklch(hex);
    let insertIdx = this.keyColors.length;
    for (let i = 0; i < this.keyColors.length; i++) {
      const existingL = ColorEngine.hexToOklch(this.keyColors[i]).L;
      if (oklch.L > existingL) {
        insertIdx = i;
        break;
      }
    }
    this.keyColors.splice(insertIdx, 0, hex);
    this._initCurves();
    this.generate();
  }

  removeKeyColor(index) {
    if (this.keyColors.length <= 1) return;
    this.keyColors.splice(index, 1);
    this._initCurves();
    this.generate();
  }

  updateKeyColor(index, hex) {
    this.keyColors[index] = hex;
    this.keyColors.sort((a, b) => ColorEngine.hexToOklch(b).L - ColorEngine.hexToOklch(a).L);
    this._initCurves();
    this.generate();
  }

  generate() {
    const mgr = this.manager;
    const stepLabels = mgr ? mgr.stepLabels : DEFAULT_STEP_LABELS;
    const numSteps = stepLabels.length;

    // Step 1: Sample desired L (linear), C, H
    const desired = [];
    for (let i = 0; i < numSteps; i++) {
      const step = stepLabels[i];
      const t = step / 900;
      const L = mgr ? mgr.getLinearL(step) : (1.0 - (1.0 - 0.15) * t);
      const C = ColorEngine.cubicHermiteInterpolate(this.curvePoints.C, t);
      const H = ColorEngine.interpolateHue(this.curvePoints.H, t);
      desired.push({
        label: step,
        t,
        desiredL: Math.max(0, Math.min(1, L)),
        C: Math.max(0, C),
        H: ((H % 360) + 360) % 360
      });
    }

    // Step 2: Enforce contrast constraints on L values
    const enforcedL = desired.map(d => d.desiredL);
    this._enforceConstraints(enforcedL, desired);

    // Step 3: Generate actual colors with enforced L
    this.steps = [];
    for (let i = 0; i < numSteps; i++) {
      const d = desired[i];
      const effectiveL = enforcedL[i];
      const wasAdjusted = Math.abs(effectiveL - d.desiredL) > 0.001;

      const gamut = ColorEngine.clampToGamut(effectiveL, d.C, d.H);
      const hex = ColorEngine.oklchToHex(gamut.L, gamut.C, gamut.H);
      const rgb = ColorEngine.hexToRgb(hex);
      const contrastWhite = ColorEngine.contrastRatio(rgb, [255, 255, 255]);
      const contrastBlack = ColorEngine.contrastRatio(rgb, [0, 0, 0]);

      // Step 0: pure white only if lightnessMax is at 1.0
      const lightMax = mgr ? mgr.lightnessMax : 1.0;
      if (d.label === 0 && lightMax >= 0.999) {
        this.steps.push({
          label: 0,
          t: 0,
          hex: '#FFFFFF',
          oklch: { L: 1, C: 0, H: d.H },
          desiredL: 1,
          effectiveL: 1,
          rgb: [255, 255, 255],
          clamped: false,
          adjusted: false,
          contrastWhite: 1,
          contrastBlack: 21,
          isMajor: mgr ? mgr.isMajor(0) : true
        });
      } else {
        this.steps.push({
          label: d.label,
          t: d.t,
          hex,
          oklch: { L: gamut.L, C: gamut.C, H: gamut.H },
          desiredL: d.desiredL,
          effectiveL,
          rgb,
          clamped: gamut.clamped,
          adjusted: wasAdjusted,
          contrastWhite,
          contrastBlack,
          isMajor: mgr ? mgr.isMajor(d.label) : (d.label % DEFAULT_MAJOR_DIVISOR === 0)
        });
      }
    }

    // Step 4: Verify with actual RGB luminances (post-gamut-clamp fix)
    this._verifyAndFixActualContrast();
  }

  _enforceConstraints(L, desired) {
    for (let iter = 0; iter < 4; iter++) {
      let changed = false;

      for (let i = 0; i < L.length; i++) {
        for (let j = i + 1; j < L.length; j++) {
          const gap = desired[j].label - desired[i].label;
          const req = getRequiredRatio(gap);
          if (!req) continue;

          const Yi = approxLuminance(L[i]);
          const maxYj = maxDarkerLuminance(Yi, req);
          const maxLj = approxL(Math.max(0, maxYj));

          if (L[j] > maxLj) {
            L[j] = maxLj;
            changed = true;
          }
        }
      }

      for (let i = L.length - 1; i >= 0; i--) {
        for (let j = i - 1; j >= 0; j--) {
          const gap = desired[i].label - desired[j].label;
          const req = getRequiredRatio(gap);
          if (!req) continue;

          const Yi = approxLuminance(L[i]);
          const minYj = minLighterLuminance(Yi, req);
          const minLj = approxL(Math.max(0, minYj));

          if (L[j] < minLj) {
            L[j] = Math.min(1, minLj);
            changed = true;
          }
        }
      }

      if (!changed) break;
    }

    // Ensure monotonically decreasing
    for (let i = 1; i < L.length; i++) {
      if (L[i] > L[i - 1]) L[i] = L[i - 1];
    }
  }

  _verifyAndFixActualContrast() {
    for (let iter = 0; iter < 3; iter++) {
      let anyFix = false;

      for (let i = 0; i < this.steps.length; i++) {
        for (let j = i + 1; j < this.steps.length; j++) {
          const gap = this.steps[j].label - this.steps[i].label;
          const req = getRequiredRatio(gap);
          if (!req) continue;

          const ratio = ColorEngine.contrastRatio(this.steps[i].rgb, this.steps[j].rgb);
          if (ratio < req) {
            let lo = 0, hi = this.steps[j].effectiveL;
            for (let k = 0; k < 20; k++) {
              const mid = (lo + hi) / 2;
              const g = ColorEngine.clampToGamut(mid, this.steps[j].oklch.C, this.steps[j].oklch.H);
              const testHex = ColorEngine.oklchToHex(g.L, g.C, g.H);
              const testRgb = ColorEngine.hexToRgb(testHex);
              const testRatio = ColorEngine.contrastRatio(this.steps[i].rgb, testRgb);
              if (testRatio >= req) lo = mid;
              else hi = mid;
            }

            const newL = lo;
            const g = ColorEngine.clampToGamut(newL, this.steps[j].oklch.C, this.steps[j].oklch.H);
            const hex = ColorEngine.oklchToHex(g.L, g.C, g.H);
            const rgb = ColorEngine.hexToRgb(hex);

            this.steps[j].effectiveL = newL;
            this.steps[j].oklch = { L: g.L, C: g.C, H: g.H };
            this.steps[j].hex = hex;
            this.steps[j].rgb = rgb;
            this.steps[j].adjusted = true;
            this.steps[j].contrastWhite = ColorEngine.contrastRatio(rgb, [255, 255, 255]);
            this.steps[j].contrastBlack = ColorEngine.contrastRatio(rgb, [0, 0, 0]);
            anyFix = true;
          }
        }
      }

      if (!anyFix) break;
    }
  }

  // Compute constraint boundaries for curve editor visualization
  getConstraintBounds() {
    const bounds = [];

    for (let i = 0; i < this.steps.length; i++) {
      let minL = 0;
      let maxL = 1;

      for (let j = 0; j < this.steps.length; j++) {
        if (i === j) continue;
        const gap = Math.abs(this.steps[j].label - this.steps[i].label);
        const req = getRequiredRatio(gap);
        if (!req) continue;

        if (this.steps[j].label < this.steps[i].label) {
          const Yj = approxLuminance(this.steps[j].effectiveL);
          const maxYi = maxDarkerLuminance(Yj, req);
          maxL = Math.min(maxL, approxL(Math.max(0, maxYi)));
        } else {
          const Yj = approxLuminance(this.steps[j].effectiveL);
          const minYi = minLighterLuminance(Yj, req);
          minL = Math.max(minL, approxL(Math.max(0, minYi)));
        }
      }

      bounds.push({
        t: this.steps[i].t,
        label: this.steps[i].label,
        minL: Math.max(0, minL),
        maxL: Math.min(1, maxL)
      });
    }

    return bounds;
  }

  getContrastValidation() {
    const constrained = [];
    for (let i = 0; i < this.steps.length; i++) {
      for (let j = i + 1; j < this.steps.length; j++) {
        const gap = this.steps[j].label - this.steps[i].label;
        const req = getRequiredRatio(gap);
        if (!req) continue;
        const ratio = ColorEngine.contrastRatio(this.steps[i].rgb, this.steps[j].rgb);
        constrained.push({ from: this.steps[i].label, to: this.steps[j].label, gap, ratio, required: req, pass: ratio >= req });
      }
    }
    return { constrained };
  }

  // Sample an arbitrary step label (0–900) using linear L schedule
  sampleStep(label) {
    const t = Math.max(0, Math.min(1, label / 900));
    const mgr = this.manager;

    const L = mgr ? mgr.getLinearL(label) : (1.0 - (1.0 - 0.15) * t);
    const C = Math.max(0, ColorEngine.cubicHermiteInterpolate(this.curvePoints.C, t));
    const H = ((ColorEngine.interpolateHue(this.curvePoints.H, t) % 360) + 360) % 360;

    const gamut = ColorEngine.clampToGamut(Math.max(0, Math.min(1, L)), C, H);
    const hex = ColorEngine.oklchToHex(gamut.L, gamut.C, gamut.H);
    const rgb = ColorEngine.hexToRgb(hex);

    return {
      label,
      hex,
      rgb,
      oklch: { L: gamut.L, C: gamut.C, H: gamut.H }
    };
  }

  toConfig() {
    return {
      name: this.name,
      keyColors: [...this.keyColors],
      curvePoints: {
        C: this.curvePoints.C.map(p => ({ x: p.x, y: p.y })),
        H: this.curvePoints.H.map(p => ({ x: p.x, y: p.y }))
      }
    };
  }

  static fromConfig(config, manager) {
    const scale = new Scale(config.name, config.keyColors, manager);
    if (config.curvePoints) {
      if (config.curvePoints.C) {
        scale.curvePoints.C = config.curvePoints.C.map(p => ({ x: p.x, y: p.y }));
      }
      if (config.curvePoints.H) {
        scale.curvePoints.H = config.curvePoints.H.map(p => ({ x: p.x, y: p.y }));
      }
      // Ignore L curve points from old configs — L is now a linear schedule
    }
    scale.generate();
    return scale;
  }

  exportJSON() {
    const obj = {};
    this.steps.forEach(s => {
      obj[s.label] = {
        hex: s.hex,
        oklch: `oklch(${s.oklch.L.toFixed(3)} ${s.oklch.C.toFixed(3)} ${s.oklch.H.toFixed(1)})`,
        rgb: `rgb(${s.rgb.join(', ')})`
      };
    });
    return obj;
  }
}

class ScaleManager {
  constructor() {
    this.scales = [];
    this.selectedId = null;

    // Global lightness limits (shared by all scales)
    this.lightnessMax = 1.0;       // step 0
    this.lightnessMin = 0.15;      // step 900

    // Step generation schedule (per-set; persisted)
    this.stepLabels = [...DEFAULT_STEP_LABELS];
    this.majorDivisor = DEFAULT_MAJOR_DIVISOR;
  }

  // Linear L schedule: step 0 = lightnessMax, step 900 = lightnessMin
  getLinearL(step) {
    return this.lightnessMax - (this.lightnessMax - this.lightnessMin) * (step / 900);
  }

  setLightnessMax(val) {
    this.lightnessMax = Math.max(0.5, Math.min(1, val));
    this.regenerateAll();
  }

  setLightnessMin(val) {
    this.lightnessMin = Math.max(0, Math.min(0.5, val));
    this.regenerateAll();
  }

  isMajor(label) {
    return label % this.majorDivisor === 0;
  }

  // Snap a label value to the nearest *defined* step in the given direction.
  // dir > 0 → nearest step at or above; dir < 0 → nearest step at or below.
  snapStep(target, dir = 1) {
    const c = Math.max(0, Math.min(900, target));
    if (dir > 0) return this.stepLabels.find(s => s >= c) ?? 900;
    return this.stepLabels.findLast(s => s <= c) ?? 0;
  }

  majorSteps() {
    return this.stepLabels.filter(s => this.isMajor(s));
  }

  // Set steps from a raw string or pre-validated array. Throws on invalid.
  // Does NOT regenerate — call regenerateAll() after if needed.
  setSteps(labelsOrString) {
    this.stepLabels = Array.isArray(labelsOrString)
      ? parseStepLabels(labelsOrString.join(','))
      : parseStepLabels(labelsOrString);
  }

  setMajorDivisor(d) {
    if (![10, 25, 50, 100].includes(d)) throw new Error('Divisor must be 10, 25, 50, or 100');
    this.majorDivisor = d;
  }

  regenerateAll() {
    this.scales.forEach(s => {
      s._initCurves();
      s.generate();
    });
  }

  addScale(name, hexOrArray) {
    const scale = new Scale(name, hexOrArray, this);
    this.scales.push(scale);
    this.selectedId = scale.id;
    return scale;
  }

  duplicateScale(id) {
    const source = this.scales.find(s => s.id === id);
    if (!source) return null;
    const idx = this.scales.indexOf(source);
    const newName = source.name + ' Copy';
    const newScale = new Scale(newName, [...source.keyColors], this);
    this.scales.splice(idx + 1, 0, newScale);
    this.selectedId = newScale.id;
    return newScale;
  }

  removeScale(id) {
    const idx = this.scales.findIndex(s => s.id === id);
    if (idx === -1) return;
    this.scales.splice(idx, 1);
    if (this.selectedId === id) {
      this.selectedId = this.scales.length > 0 ? this.scales[0].id : null;
    }
  }

  moveScale(id, newIndex) {
    const oldIndex = this.scales.findIndex(s => s.id === id);
    if (oldIndex === -1 || oldIndex === newIndex) return;
    const [scale] = this.scales.splice(oldIndex, 1);
    this.scales.splice(newIndex, 0, scale);
  }

  getSelected() {
    return this.scales.find(s => s.id === this.selectedId) || null;
  }

  select(id) {
    this.selectedId = id;
  }

  toConfig() {
    return {
      lightnessMax: this.lightnessMax,
      lightnessMin: this.lightnessMin,
      stepLabels: [...this.stepLabels],
      majorDivisor: this.majorDivisor,
      scales: this.scales.map(s => s.toConfig()),
      selectedId: this.selectedId
    };
  }

  fromConfig(config) {
    // Read lightness limits (support both new and old property names)
    if (config.lightnessMax != null) this.lightnessMax = config.lightnessMax;
    else if (config.whiteLimit != null) this.lightnessMax = config.whiteLimit;

    if (config.lightnessMin != null) this.lightnessMin = config.lightnessMin;
    else if (config.blackLimit != null) this.lightnessMin = config.blackLimit;

    // Steps (default to module constants if absent — supports pre-v4 configs)
    this.stepLabels = Array.isArray(config.stepLabels) && config.stepLabels.length >= 2
      ? [...config.stepLabels]
      : [...DEFAULT_STEP_LABELS];
    this.majorDivisor = config.majorDivisor ?? DEFAULT_MAJOR_DIVISOR;

    this.scales = config.scales.map(c => Scale.fromConfig(c, this));
    this.selectedId = config.selectedId;
  }

  exportAllCSS() {
    const vars = this.scales.map(s => {
      const prefix = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      return s.steps.map(st => `  --${prefix}-${st.label}: ${st.hex};`).join('\n');
    }).join('\n\n');
    return `:root {\n${vars}\n}`;
  }

  exportAllJSON() {
    const result = {};
    this.scales.forEach(s => {
      const key = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      result[key] = s.exportJSON();
    });
    return JSON.stringify(result, null, 2);
  }

  exportW3CTokens() {
    const tokens = {};
    this.scales.forEach(s => {
      const key = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const group = {};
      s.steps.forEach(step => {
        group[step.label] = {
          "$value": step.hex,
          "$type": "color",
          "$description": `oklch(${step.oklch.L.toFixed(3)} ${step.oklch.C.toFixed(3)} ${step.oklch.H.toFixed(1)})`
        };
      });
      tokens[key] = group;
    });
    return JSON.stringify(tokens, null, 2);
  }

  exportTailwindV3() {
    const colors = {};
    this.scales.forEach(s => {
      const key = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const scale = {};
      s.steps.forEach(st => { scale[st.label] = st.hex; });
      colors[key] = scale;
    });
    const obj = { theme: { extend: { colors } } };
    return '// tailwind.config.js\nmodule.exports = ' + JSON.stringify(obj, null, 2);
  }

  exportTailwindV4() {
    const vars = this.scales.map(s => {
      const prefix = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      return s.steps.map(st => `  --color-${prefix}-${st.label}: ${st.hex};`).join('\n');
    }).join('\n\n');
    return `@theme {\n${vars}\n}`;
  }
}

if (typeof module !== 'undefined') module.exports = {
  Scale, ScaleManager, getRequiredRatio,
  DEFAULT_STEP_LABELS, DEFAULT_MAJOR_DIVISOR, parseStepLabels
};
