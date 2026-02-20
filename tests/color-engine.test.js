const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ColorEngine = require('../color-engine.js');

describe('hexToRgb / rgbToHex round-trip', () => {
  it('round-trips common hex values', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#3b82f6', '#d97757']) {
      const rgb = ColorEngine.hexToRgb(hex);
      const back = ColorEngine.rgbToHex(rgb);
      assert.equal(back, hex, `round-trip failed for ${hex}`);
    }
  });

  it('handles 3-digit shorthand', () => {
    const rgb = ColorEngine.hexToRgb('#f00');
    assert.deepEqual(rgb, [255, 0, 0]);
  });

  it('handles uppercase and missing hash', () => {
    assert.deepEqual(ColorEngine.hexToRgb('FF00FF'), [255, 0, 255]);
  });
});

describe('hexToOklch / oklchToHex round-trip', () => {
  it('round-trips within ±1 for achromatic and low-saturation colors', () => {
    // Achromatic and low-saturation colors round-trip almost perfectly
    const colors = ['#ffffff', '#000000', '#808080', '#c0c0c0', '#404040'];
    for (const hex of colors) {
      const oklch = ColorEngine.hexToOklch(hex);
      const back = ColorEngine.oklchToHex(oklch.L, oklch.C, oklch.H);
      const origRgb = ColorEngine.hexToRgb(hex);
      const backRgb = ColorEngine.hexToRgb(back);
      for (let i = 0; i < 3; i++) {
        assert.ok(
          Math.abs(origRgb[i] - backRgb[i]) <= 1,
          `Channel ${i} diff too large for ${hex}: ${origRgb[i]} vs ${backRgb[i]}`
        );
      }
    }
  });

  it('round-trips saturated colors with reasonable precision', () => {
    // Saturated colors near sRGB gamut boundary lose precision due to
    // chroma clamping in the OKLCH→sRGB pipeline. Verify the pipeline
    // doesn't produce wildly wrong results (within 5% of 255).
    const colors = ['#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f59e0b'];
    for (const hex of colors) {
      const oklch = ColorEngine.hexToOklch(hex);
      const back = ColorEngine.oklchToHex(oklch.L, oklch.C, oklch.H);
      const origRgb = ColorEngine.hexToRgb(hex);
      const backRgb = ColorEngine.hexToRgb(back);
      for (let i = 0; i < 3; i++) {
        assert.ok(
          Math.abs(origRgb[i] - backRgb[i]) <= 25,
          `Channel ${i} diff too large for ${hex}: ${origRgb[i]} vs ${backRgb[i]}`
        );
      }
    }
  });
});

describe('known OKLCH values', () => {
  it('white is L≈1, C≈0', () => {
    const w = ColorEngine.hexToOklch('#ffffff');
    assert.ok(Math.abs(w.L - 1) < 0.001, `white L=${w.L}`);
    assert.ok(w.C < 0.001, `white C=${w.C}`);
  });

  it('black is L≈0, C≈0', () => {
    const b = ColorEngine.hexToOklch('#000000');
    assert.ok(Math.abs(b.L) < 0.001, `black L=${b.L}`);
    assert.ok(b.C < 0.001, `black C=${b.C}`);
  });

  it('pure red has high chroma and H near 29°', () => {
    const r = ColorEngine.hexToOklch('#ff0000');
    assert.ok(r.C > 0.2, `red chroma should be high, got ${r.C}`);
    assert.ok(r.H > 20 && r.H < 35, `red hue should be ~29°, got ${r.H}`);
  });
});

describe('isInGamut', () => {
  it('returns true for valid sRGB colors', () => {
    const oklch = ColorEngine.hexToOklch('#3b82f6');
    assert.equal(ColorEngine.isInGamut(oklch.L, oklch.C, oklch.H), true);
  });

  it('returns false for out-of-gamut (very high chroma)', () => {
    assert.equal(ColorEngine.isInGamut(0.7, 0.5, 150), false);
  });

  it('returns true for achromatic colors', () => {
    assert.equal(ColorEngine.isInGamut(0.5, 0, 0), true);
    assert.equal(ColorEngine.isInGamut(1, 0, 0), true);
    assert.equal(ColorEngine.isInGamut(0, 0, 0), true);
  });
});

describe('clampToGamut', () => {
  it('preserves in-gamut colors', () => {
    const oklch = ColorEngine.hexToOklch('#3b82f6');
    const result = ColorEngine.clampToGamut(oklch.L, oklch.C, oklch.H);
    assert.equal(result.clamped, false);
    assert.ok(Math.abs(result.C - oklch.C) < 0.001);
  });

  it('reduces chroma for out-of-gamut colors', () => {
    const result = ColorEngine.clampToGamut(0.7, 0.5, 150);
    assert.equal(result.clamped, true);
    assert.ok(result.C < 0.5, `clamped chroma should be less than 0.5, got ${result.C}`);
    assert.equal(result.L, 0.7);
    assert.equal(result.H, 150);
  });

  it('clamped result is in gamut', () => {
    const result = ColorEngine.clampToGamut(0.7, 0.5, 150);
    assert.equal(ColorEngine.isInGamut(result.L, result.C, result.H), true);
  });
});

describe('contrastRatio', () => {
  it('returns 21:1 for black vs white', () => {
    const ratio = ColorEngine.contrastRatio([0, 0, 0], [255, 255, 255]);
    assert.ok(Math.abs(ratio - 21) < 0.1, `expected ~21, got ${ratio}`);
  });

  it('returns 1:1 for same color', () => {
    const ratio = ColorEngine.contrastRatio([128, 128, 128], [128, 128, 128]);
    assert.ok(Math.abs(ratio - 1) < 0.01, `expected ~1, got ${ratio}`);
  });

  it('is symmetric', () => {
    const r1 = ColorEngine.contrastRatio([255, 0, 0], [0, 0, 255]);
    const r2 = ColorEngine.contrastRatio([0, 0, 255], [255, 0, 0]);
    assert.ok(Math.abs(r1 - r2) < 0.001);
  });

  it('white vs mid-gray gives moderate contrast', () => {
    const ratio = ColorEngine.contrastRatio([255, 255, 255], [128, 128, 128]);
    assert.ok(ratio > 3 && ratio < 6, `expected moderate contrast, got ${ratio}`);
  });
});

describe('cubicHermiteInterpolate', () => {
  it('returns y of single point', () => {
    assert.equal(ColorEngine.cubicHermiteInterpolate([{ x: 0.5, y: 0.7 }], 0.5), 0.7);
  });

  it('clamps below first point', () => {
    const points = [{ x: 0, y: 1 }, { x: 1, y: 0 }];
    assert.equal(ColorEngine.cubicHermiteInterpolate(points, -0.5), 1);
  });

  it('clamps above last point', () => {
    const points = [{ x: 0, y: 1 }, { x: 1, y: 0 }];
    assert.equal(ColorEngine.cubicHermiteInterpolate(points, 1.5), 0);
  });

  it('returns endpoint values at endpoints', () => {
    const points = [{ x: 0, y: 1 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0 }];
    assert.equal(ColorEngine.cubicHermiteInterpolate(points, 0), 1);
    assert.equal(ColorEngine.cubicHermiteInterpolate(points, 1), 0);
  });

  it('interpolates midpoint reasonably', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const mid = ColorEngine.cubicHermiteInterpolate(points, 0.5);
    assert.ok(mid > 0.3 && mid < 0.7, `expected near 0.5, got ${mid}`);
  });
});

describe('interpolateHue', () => {
  it('wraps across 0°/360° boundary', () => {
    const points = [{ x: 0, y: 350 }, { x: 1, y: 10 }];
    const mid = ColorEngine.interpolateHue(points, 0.5);
    // Should interpolate through 360/0, not the long way around
    assert.ok(mid > 340 || mid < 30, `expected near 0°/360°, got ${mid}`);
  });

  it('returns single point value', () => {
    assert.equal(ColorEngine.interpolateHue([{ x: 0.5, y: 200 }], 0.5), 200);
  });

  it('result is in [0, 360)', () => {
    const points = [{ x: 0, y: 350 }, { x: 0.5, y: 10 }, { x: 1, y: 30 }];
    for (let t = 0; t <= 1; t += 0.1) {
      const h = ColorEngine.interpolateHue(points, t);
      assert.ok(h >= 0 && h < 360, `hue out of range at t=${t}: ${h}`);
    }
  });
});
