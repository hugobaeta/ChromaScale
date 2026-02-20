// ChromaScale — Scale Manager v2
// 35-step scales with contrast constraint enforcement

// Full step labels: 10s at ends, 50s in the middle
const STEP_LABELS = [
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
  150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750,
  800, 810, 820, 830, 840, 850, 860, 870, 880, 890, 900
];

// Which steps are "major" (50-intervals) vs "minor" (10-intervals)
const MAJOR_STEPS = new Set([0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900]);

// Contrast requirement for a given step gap
// A = 3:1 (large text), AA = 4.5:1 (normal text), AAA = 7:1 (enhanced)
function getRequiredRatio(gap) {
  if (gap >= 650) return 7;    // AAA
  if (gap >= 550) return 4.5;  // AA
  if (gap >= 450) return 3;    // A
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
  constructor(name, keyHexOrArray) {
    this.id = 'scale_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    this.name = name || 'Untitled';
    
    if (Array.isArray(keyHexOrArray)) {
      this.keyColors = [...keyHexOrArray];
    } else {
      this.keyColors = keyHexOrArray ? [keyHexOrArray] : ['#3B82F6'];
    }
    
    // Derive white/black limits from the key colors
    const oklchFirst = ColorEngine.hexToOklch(this.keyColors[0]);
    const oklchLast = ColorEngine.hexToOklch(this.keyColors[this.keyColors.length - 1]);
    
    // Step 0 is always pure white; step 900 targets L≈0.15 for consistent dark end
    this.whiteLimit = 1.0;
    this.blackLimit = 0.15;
    
    // Dark mode endpoints — independent from light mode
    this.darkBlackLimit = 0.15;  // step 0 in dark mode (darkest bg)
    this.darkWhiteLimit = 0.95;  // step 900 in dark mode (lightest text, slightly off-white)
    
    this.steps = [];
    this.curvePoints = { L: [], C: [], H: [] };
    this.outOfRangeCount = 0;       // how many key colors are beyond step 900
    this.outOfRangeIndices = [];     // which indices are out of range
    
    this._initCurves();
    this.generate();
  }

  _initCurves() {
    const allOklch = this.keyColors.map(hex => ColorEngine.hexToOklch(hex));
    
    // Filter out colors that are darker than the 900 level (blackLimit)
    // These are "out of range" — too dark to appear in the 0-900 scale
    this.outOfRangeIndices = [];
    const inRangeOklch = [];
    const inRangeIdx = [];
    
    allOklch.forEach((c, i) => {
      if (c.L < this.blackLimit - 0.005) {
        // This color is darker than step 900 would be — out of range
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
    
    if (n === 1) {
      const c = oklchColors[0];
      this.curvePoints = {
        L: [
          { x: 0, y: 1.0 },
          { x: 0.5, y: c.L },
          { x: 1, y: this.blackLimit }
        ],
        C: [
          { x: 0, y: 0 },
          { x: 0.5, y: c.C },
          { x: 1, y: 0 }
        ],
        H: [
          { x: 0, y: c.H },
          { x: 0.5, y: c.H },
          { x: 1, y: c.H }
        ]
      };
    } else {
      // Multiple key colors: start from pure white, map in-range key colors
      const lPoints = [{ x: 0, y: 1.0 }];
      const cPoints = [{ x: 0, y: 0 }];
      const hPoints = [{ x: 0, y: oklchColors[0].H }];
      
      oklchColors.forEach((c, i) => {
        const pos = (i + 1) / (n + 1);
        lPoints.push({ x: pos, y: c.L });
        cPoints.push({ x: pos, y: c.C });
        hPoints.push({ x: pos, y: c.H });
      });
      
      // Black endpoint at step 900
      lPoints.push({ x: 1, y: this.blackLimit });
      cPoints.push({ x: 1, y: 0 });
      hPoints.push({ x: 1, y: oklchColors[n - 1].H });
      
      this.curvePoints = { L: lPoints, C: cPoints, H: hPoints };
    }
  }

  addKeyColor(hex) {
    // Insert sorted by luminance (descending: lightest first → darkest last)
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
    // Re-sort by luminance (descending: lightest first → darkest last)
    this.keyColors.sort((a, b) => ColorEngine.hexToOklch(b).L - ColorEngine.hexToOklch(a).L);
    this._initCurves();
    this.generate();
  }

  setWhiteLimit(val) {
    this.whiteLimit = Math.max(0.5, Math.min(1, val));
    if (this.curvePoints.L.length > 0) {
      this.curvePoints.L[0].y = this.whiteLimit;
    }
    this.generate();
  }

  setBlackLimit(val) {
    this.blackLimit = Math.max(0, Math.min(0.5, val));
    if (this.curvePoints.L.length > 0) {
      this.curvePoints.L[this.curvePoints.L.length - 1].y = this.blackLimit;
    }
    this.generate();
  }

  setDarkBlackLimit(val) {
    this.darkBlackLimit = Math.max(0, Math.min(0.5, val));
    this.generate();
  }

  setDarkWhiteLimit(val) {
    this.darkWhiteLimit = Math.max(0.5, Math.min(1, val));
    this.generate();
  }

  // Remap a lightness value from [blackLimit, whiteLimit] to [darkBlackLimit, darkWhiteLimit]
  darkRemapL(L) {
    const range = this.whiteLimit - this.blackLimit;
    if (range <= 0) return L;
    const normalized = (L - this.blackLimit) / range;
    return this.darkBlackLimit + normalized * (this.darkWhiteLimit - this.darkBlackLimit);
  }

  generate() {
    const numSteps = STEP_LABELS.length;
    
    // Step 1: Sample desired L, C, H from curves
    const desired = [];
    for (let i = 0; i < numSteps; i++) {
      const t = STEP_LABELS[i] / 900; // position = label / 900
      const L = ColorEngine.cubicHermiteInterpolate(this.curvePoints.L, t);
      const C = ColorEngine.cubicHermiteInterpolate(this.curvePoints.C, t);
      const H = ColorEngine.interpolateHue(this.curvePoints.H, t);
      desired.push({
        label: STEP_LABELS[i],
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
      
      // Step 0 is always pure white
      if (d.label === 0) {
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
          isMajor: MAJOR_STEPS.has(0)
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
          isMajor: MAJOR_STEPS.has(d.label)
        });
      }
    }
    
    // Step 4: Verify with actual RGB luminances (post-gamut-clamp fix)
    this._verifyAndFixActualContrast();
    
    // Step 5: Generate dark mode steps
    this._generateDarkMode();
  }

  _generateDarkMode() {
    const numSteps = STEP_LABELS.length;
    
    // Dark mode: reverse the L curve, then remap endpoints to dark mode limits
    const desiredDark = [];
    for (let i = 0; i < numSteps; i++) {
      const t = STEP_LABELS[i] / 900;
      const tReversed = 1 - t;
      const rawL = ColorEngine.cubicHermiteInterpolate(this.curvePoints.L, tReversed);
      // Remap from [blackLimit, whiteLimit] → [darkBlackLimit, darkWhiteLimit]
      const L = this.darkRemapL(Math.max(0, Math.min(1, rawL)));
      const C = ColorEngine.cubicHermiteInterpolate(this.curvePoints.C, t);
      const H = ColorEngine.interpolateHue(this.curvePoints.H, t);
      desiredDark.push({
        label: STEP_LABELS[i],
        t,
        desiredL: Math.max(0, Math.min(1, L)),
        C: Math.max(0, C),
        H: ((H % 360) + 360) % 360
      });
    }
    
    // Enforce monotonically INCREASING L for dark mode (step 0 = dark, step 900 = light)
    const enforcedL = desiredDark.map(d => d.desiredL);
    // Force step 900 (last) to dark white limit
    enforcedL[enforcedL.length - 1] = this.darkWhiteLimit;
    // Force step 0 (first) to dark black limit
    enforcedL[0] = Math.min(enforcedL[0], this.darkBlackLimit);
    this._enforceDarkConstraints(enforcedL, desiredDark);
    
    // Generate actual colors
    this.darkSteps = [];
    for (let i = 0; i < numSteps; i++) {
      const d = desiredDark[i];
      const effectiveL = enforcedL[i];
      const wasAdjusted = Math.abs(effectiveL - d.desiredL) > 0.001;
      
      const gamut = ColorEngine.clampToGamut(effectiveL, d.C, d.H);
      const hex = ColorEngine.oklchToHex(gamut.L, gamut.C, gamut.H);
      const rgb = ColorEngine.hexToRgb(hex);
      const contrastWhite = ColorEngine.contrastRatio(rgb, [255, 255, 255]);
      const contrastBlack = ColorEngine.contrastRatio(rgb, [0, 0, 0]);
      
      // Step 900: use darkWhiteLimit (only pure white if limit is 1.0)
      if (d.label === 900 && this.darkWhiteLimit >= 0.999) {
        this.darkSteps.push({
          label: 900,
          t: 1,
          hex: '#FFFFFF',
          oklch: { L: 1, C: 0, H: d.H },
          desiredL: 1,
          effectiveL: 1,
          rgb: [255, 255, 255],
          clamped: false,
          adjusted: false,
          contrastWhite: 1,
          contrastBlack: 21,
          isMajor: MAJOR_STEPS.has(900)
        });
      } else {
        this.darkSteps.push({
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
          isMajor: MAJOR_STEPS.has(d.label)
        });
      }
    }
    
    // Verify dark mode contrasts with actual RGB
    this._verifyAndFixDarkContrast();
  }

  _enforceDarkConstraints(L, desired) {
    // In dark mode, L is monotonically INCREASING (step 0 = darkest, step 900 = lightest)
    // Contrast constraints are the same: gap ≥ 450 → 3:1, gap ≥ 550 → 4.5:1
    for (let iter = 0; iter < 4; iter++) {
      let changed = false;
      
      // Forward pass: ensure lighter steps (higher index) are light enough
      for (let i = 0; i < L.length; i++) {
        for (let j = i + 1; j < L.length; j++) {
          const gap = desired[j].label - desired[i].label;
          const req = getRequiredRatio(gap);
          if (!req) continue;
          
          // i is darker, j should be lighter; need enough contrast
          const Yi = approxLuminance(L[i]);
          const minYj = minLighterLuminance(Yi, req);
          const minLj = approxL(Math.max(0, minYj));
          
          if (L[j] < minLj) {
            L[j] = Math.min(1, minLj);
            changed = true;
          }
        }
      }
      
      // Backward pass: ensure darker steps (lower index) are dark enough
      for (let i = L.length - 1; i >= 0; i--) {
        for (let j = i - 1; j >= 0; j--) {
          const gap = desired[i].label - desired[j].label;
          const req = getRequiredRatio(gap);
          if (!req) continue;
          
          // i is lighter, j should be darker
          const Yi = approxLuminance(L[i]);
          const maxYj = maxDarkerLuminance(Yi, req);
          const maxLj = approxL(Math.max(0, maxYj));
          
          if (L[j] > maxLj) {
            L[j] = maxLj;
            changed = true;
          }
        }
      }
      
      if (!changed) break;
    }
    
    // Ensure monotonically increasing
    for (let i = 1; i < L.length; i++) {
      if (L[i] < L[i - 1]) L[i] = L[i - 1];
    }
  }

  _verifyAndFixDarkContrast() {
    // Same as light mode verification but for dark steps
    // More iterations needed since dark end has compressed perceptual space
    for (let iter = 0; iter < 4; iter++) {
      let anyFix = false;
      
      for (let i = 0; i < this.darkSteps.length; i++) {
        for (let j = i + 1; j < this.darkSteps.length; j++) {
          const gap = this.darkSteps[j].label - this.darkSteps[i].label;
          const req = getRequiredRatio(gap);
          if (!req) continue;
          
          const ratio = ColorEngine.contrastRatio(this.darkSteps[i].rgb, this.darkSteps[j].rgb);
          if (ratio < req) {
            const reqWithMargin = req + 0.05;
            
            // Strategy: try to lighten j first, but if j is already very light (e.g. white),
            // darken i instead
            const jIsMaxLight = this.darkSteps[j].effectiveL >= 0.99;
            
            if (jIsMaxLight) {
              // Darken step i to increase contrast with light step j
              let lo = 0, hi = this.darkSteps[i].effectiveL;
              for (let k = 0; k < 16; k++) {
                const mid = (lo + hi) / 2;
                const g = ColorEngine.clampToGamut(mid, this.darkSteps[i].oklch.C, this.darkSteps[i].oklch.H);
                const testHex = ColorEngine.oklchToHex(g.L, g.C, g.H);
                const testRgb = ColorEngine.hexToRgb(testHex);
                const testRatio = ColorEngine.contrastRatio(testRgb, this.darkSteps[j].rgb);
                if (testRatio >= reqWithMargin) lo = mid;
                else hi = mid;
              }
              
              const newL = lo;
              const g = ColorEngine.clampToGamut(newL, this.darkSteps[i].oklch.C, this.darkSteps[i].oklch.H);
              const hex = ColorEngine.oklchToHex(g.L, g.C, g.H);
              const rgb = ColorEngine.hexToRgb(hex);
              
              this.darkSteps[i].effectiveL = newL;
              this.darkSteps[i].oklch = { L: g.L, C: g.C, H: g.H };
              this.darkSteps[i].hex = hex;
              this.darkSteps[i].rgb = rgb;
              this.darkSteps[i].adjusted = true;
              this.darkSteps[i].contrastWhite = ColorEngine.contrastRatio(rgb, [255, 255, 255]);
              this.darkSteps[i].contrastBlack = ColorEngine.contrastRatio(rgb, [0, 0, 0]);
              anyFix = true;
            } else {
              // Lighten step j
              let lo = this.darkSteps[j].effectiveL, hi = 1;
              for (let k = 0; k < 16; k++) {
                const mid = (lo + hi) / 2;
                const g = ColorEngine.clampToGamut(mid, this.darkSteps[j].oklch.C, this.darkSteps[j].oklch.H);
                const testHex = ColorEngine.oklchToHex(g.L, g.C, g.H);
                const testRgb = ColorEngine.hexToRgb(testHex);
                const testRatio = ColorEngine.contrastRatio(this.darkSteps[i].rgb, testRgb);
                if (testRatio >= reqWithMargin) hi = mid;
                else lo = mid;
              }
              
              const newL = hi;
              const g = ColorEngine.clampToGamut(newL, this.darkSteps[j].oklch.C, this.darkSteps[j].oklch.H);
              const hex = ColorEngine.oklchToHex(g.L, g.C, g.H);
              const rgb = ColorEngine.hexToRgb(hex);
              
              this.darkSteps[j].effectiveL = newL;
              this.darkSteps[j].oklch = { L: g.L, C: g.C, H: g.H };
              this.darkSteps[j].hex = hex;
              this.darkSteps[j].rgb = rgb;
              this.darkSteps[j].adjusted = true;
              this.darkSteps[j].contrastWhite = ColorEngine.contrastRatio(rgb, [255, 255, 255]);
              this.darkSteps[j].contrastBlack = ColorEngine.contrastRatio(rgb, [0, 0, 0]);
              anyFix = true;
            }
          }
        }
      }
      
      if (!anyFix) break;
    }
  }

  _enforceConstraints(L, desired) {
    // Multiple passes to propagate constraints
    for (let iter = 0; iter < 4; iter++) {
      let changed = false;
      
      // Forward pass: ensure darker steps are dark enough
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
      
      // Backward pass: ensure lighter steps are light enough
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
    // After gamut clamping, actual RGB luminances may differ from OKLCH L^3 estimates
    // Do a verification pass with real contrast ratios and adjust if needed
    for (let iter = 0; iter < 3; iter++) {
      let anyFix = false;
      
      for (let i = 0; i < this.steps.length; i++) {
        for (let j = i + 1; j < this.steps.length; j++) {
          const gap = this.steps[j].label - this.steps[i].label;
          const req = getRequiredRatio(gap);
          if (!req) continue;
          
          const ratio = ColorEngine.contrastRatio(this.steps[i].rgb, this.steps[j].rgb);
          if (ratio < req) {
            // Need to darken step j slightly
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
  // Returns array of { t, minL, maxL } for each step position
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
          // j is lighter, i must be dark enough
          const Yj = approxLuminance(this.steps[j].effectiveL);
          const maxYi = maxDarkerLuminance(Yj, req);
          maxL = Math.min(maxL, approxL(Math.max(0, maxYi)));
        } else {
          // j is darker, i must be light enough
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

  // Check all contrast constraints (for validation display)
  getContrastValidation() {
    const constrained = [];
    
    // Check all pairs with constraints
    for (let i = 0; i < this.steps.length; i++) {
      for (let j = i + 1; j < this.steps.length; j++) {
        const gap = this.steps[j].label - this.steps[i].label;
        const req = getRequiredRatio(gap);
        if (!req) continue;
        
        const ratio = ColorEngine.contrastRatio(this.steps[i].rgb, this.steps[j].rgb);
        constrained.push({
          from: this.steps[i].label,
          to: this.steps[j].label,
          gap,
          ratio,
          required: req,
          pass: ratio >= req
        });
      }
    }
    
    return { constrained };
  }

  getSteps(mode) {
    return mode === 'dark' ? (this.darkSteps || []) : this.steps;
  }

  getDarkContrastValidation() {
    const steps = this.darkSteps || [];
    const constrained = [];
    for (let i = 0; i < steps.length; i++) {
      for (let j = i + 1; j < steps.length; j++) {
        const gap = steps[j].label - steps[i].label;
        const req = getRequiredRatio(gap);
        if (!req) continue;
        const ratio = ColorEngine.contrastRatio(steps[i].rgb, steps[j].rgb);
        constrained.push({ from: steps[i].label, to: steps[j].label, gap, ratio, required: req, pass: ratio >= req });
      }
    }
    return { constrained };
  }

  // Sample an arbitrary step label (0–900) from the OKLCH curves
  // Returns { light: { hex, rgb, oklch }, dark: { hex, rgb, oklch } }
  sampleStep(label) {
    const t = Math.max(0, Math.min(1, label / 900));
    
    // Light mode
    const L = Math.max(0, Math.min(1, ColorEngine.cubicHermiteInterpolate(this.curvePoints.L, t)));
    const C = Math.max(0, ColorEngine.cubicHermiteInterpolate(this.curvePoints.C, t));
    const H = ((ColorEngine.interpolateHue(this.curvePoints.H, t) % 360) + 360) % 360;
    
    const lightGamut = ColorEngine.clampToGamut(L, C, H);
    const lightHex = ColorEngine.oklchToHex(lightGamut.L, lightGamut.C, lightGamut.H);
    const lightRgb = ColorEngine.hexToRgb(lightHex);
    
    // Dark mode — reverse L, remap endpoints
    const tReversed = 1 - t;
    const rawDarkL = ColorEngine.cubicHermiteInterpolate(this.curvePoints.L, tReversed);
    const darkL = this.darkRemapL(Math.max(0, Math.min(1, rawDarkL)));
    const darkC = Math.max(0, ColorEngine.cubicHermiteInterpolate(this.curvePoints.C, t));
    const darkH = ((ColorEngine.interpolateHue(this.curvePoints.H, t) % 360) + 360) % 360;
    
    const darkGamut = ColorEngine.clampToGamut(darkL, darkC, darkH);
    const darkHex = ColorEngine.oklchToHex(darkGamut.L, darkGamut.C, darkGamut.H);
    const darkRgb = ColorEngine.hexToRgb(darkHex);
    
    return {
      label,
      light: { hex: lightHex, rgb: lightRgb, oklch: { L: lightGamut.L, C: lightGamut.C, H: lightGamut.H } },
      dark: { hex: darkHex, rgb: darkRgb, oklch: { L: darkGamut.L, C: darkGamut.C, H: darkGamut.H } }
    };
  }

  toConfig() {
    return {
      name: this.name,
      keyColors: [...this.keyColors],
      whiteLimit: this.whiteLimit,
      blackLimit: this.blackLimit,
      darkWhiteLimit: this.darkWhiteLimit,
      darkBlackLimit: this.darkBlackLimit,
      curvePoints: {
        L: this.curvePoints.L.map(p => ({ x: p.x, y: p.y })),
        C: this.curvePoints.C.map(p => ({ x: p.x, y: p.y })),
        H: this.curvePoints.H.map(p => ({ x: p.x, y: p.y }))
      }
    };
  }

  static fromConfig(config) {
    const scale = new Scale(config.name, config.keyColors);
    scale.whiteLimit = config.whiteLimit;
    scale.blackLimit = config.blackLimit;
    scale.darkWhiteLimit = config.darkWhiteLimit;
    scale.darkBlackLimit = config.darkBlackLimit;
    scale.curvePoints = {
      L: config.curvePoints.L.map(p => ({ x: p.x, y: p.y })),
      C: config.curvePoints.C.map(p => ({ x: p.x, y: p.y })),
      H: config.curvePoints.H.map(p => ({ x: p.x, y: p.y }))
    };
    scale.generate();
    return scale;
  }

  exportJSON() {
    const obj = { light: {}, dark: {} };
    this.steps.forEach(s => {
      obj.light[s.label] = {
        hex: s.hex,
        oklch: `oklch(${s.oklch.L.toFixed(3)} ${s.oklch.C.toFixed(3)} ${s.oklch.H.toFixed(1)})`,
        rgb: `rgb(${s.rgb.join(', ')})`
      };
    });
    (this.darkSteps || []).forEach(s => {
      obj.dark[s.label] = {
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
  }

  addScale(name, hexOrArray) {
    const scale = new Scale(name, hexOrArray);
    this.scales.push(scale);
    this.selectedId = scale.id;
    return scale;
  }

  duplicateScale(id) {
    const source = this.scales.find(s => s.id === id);
    if (!source) return null;
    const idx = this.scales.indexOf(source);
    const newName = source.name + ' Copy';
    const newScale = new Scale(newName, [...source.keyColors]);
    // Insert right after the source scale
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
      scales: this.scales.map(s => s.toConfig()),
      selectedId: this.selectedId
    };
  }

  fromConfig(config) {
    this.scales = config.scales.map(c => Scale.fromConfig(c));
    this.selectedId = config.selectedId;
  }

  exportAllCSS() {
    const lightVars = this.scales.map(s => {
      const prefix = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      return s.steps.map(st => `  --${prefix}-${st.label}: ${st.hex};`).join('\n');
    }).join('\n\n');

    const darkVars = this.scales.map(s => {
      const prefix = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      return (s.darkSteps || []).map(st => `  --${prefix}-${st.label}: ${st.hex};`).join('\n');
    }).join('\n\n');

    return `:root {\n${lightVars}\n}\n\n[data-theme="dark"],\n.dark {\n${darkVars}\n}\n\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${darkVars}\n  }\n}`;
  }

  exportAllJSON() {
    const result = {};
    this.scales.forEach(s => {
      const key = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      result[key] = s.exportJSON();
    });
    return JSON.stringify(result, null, 2);
  }

  // Export as W3C Design Tokens / Tokens Studio format (Figma Variables compatible)
  exportFigmaTokens() {
    const tokens = { light: {}, dark: {} };
    this.scales.forEach(s => {
      const key = s.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const lightGroup = {};
      const darkGroup = {};
      s.steps.forEach(step => {
        lightGroup[step.label] = {
          "$value": step.hex,
          "$type": "color",
          "$description": `oklch(${step.oklch.L.toFixed(3)} ${step.oklch.C.toFixed(3)} ${step.oklch.H.toFixed(1)})`
        };
      });
      (s.darkSteps || []).forEach(step => {
        darkGroup[step.label] = {
          "$value": step.hex,
          "$type": "color",
          "$description": `oklch(${step.oklch.L.toFixed(3)} ${step.oklch.C.toFixed(3)} ${step.oklch.H.toFixed(1)})`
        };
      });
      tokens.light[key] = lightGroup;
      tokens.dark[key] = darkGroup;
    });
    return JSON.stringify(tokens, null, 2);
  }
}

if (typeof module !== 'undefined') module.exports = { Scale, ScaleManager, STEP_LABELS, MAJOR_STEPS, getRequiredRatio };
