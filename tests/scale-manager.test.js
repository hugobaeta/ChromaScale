const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ColorEngine = require('../color-engine.js');

// Make ColorEngine available globally (Scale/ScaleManager reference it as a global)
globalThis.ColorEngine = ColorEngine;

const { Scale, ScaleManager, STEP_LABELS, MAJOR_STEPS, getRequiredRatio } = require('../scale-manager.js');

describe('STEP_LABELS', () => {
  it('has exactly 35 entries', () => {
    assert.equal(STEP_LABELS.length, 35);
  });

  it('starts at 0 and ends at 900', () => {
    assert.equal(STEP_LABELS[0], 0);
    assert.equal(STEP_LABELS[STEP_LABELS.length - 1], 900);
  });

  it('is sorted ascending', () => {
    for (let i = 1; i < STEP_LABELS.length; i++) {
      assert.ok(STEP_LABELS[i] > STEP_LABELS[i - 1]);
    }
  });
});

describe('getRequiredRatio', () => {
  it('returns 7 for gap >= 650', () => {
    assert.equal(getRequiredRatio(650), 7);
    assert.equal(getRequiredRatio(900), 7);
  });

  it('returns 4.5 for gap 550-649', () => {
    assert.equal(getRequiredRatio(550), 4.5);
    assert.equal(getRequiredRatio(600), 4.5);
  });

  it('returns 3 for gap 450-549', () => {
    assert.equal(getRequiredRatio(450), 3);
    assert.equal(getRequiredRatio(500), 3);
  });

  it('returns null for gap < 450', () => {
    assert.equal(getRequiredRatio(400), null);
    assert.equal(getRequiredRatio(0), null);
  });
});

describe('Scale generation', () => {
  it('produces exactly 35 light steps', () => {
    const s = new Scale('Blue', '#3b82f6');
    assert.equal(s.steps.length, 35);
  });

  it('produces exactly 35 dark steps', () => {
    const s = new Scale('Blue', '#3b82f6');
    assert.equal(s.darkSteps.length, 35);
  });

  it('step 0 is always #FFFFFF in light mode', () => {
    const s = new Scale('Blue', '#3b82f6');
    assert.equal(s.steps[0].hex.toUpperCase(), '#FFFFFF');
    assert.equal(s.steps[0].label, 0);
  });

  it('step labels match STEP_LABELS', () => {
    const s = new Scale('Red', '#ef4444');
    const labels = s.steps.map(st => st.label);
    assert.deepEqual(labels, STEP_LABELS);
  });

  it('light mode steps have monotonically decreasing L', () => {
    const s = new Scale('Blue', '#3b82f6');
    for (let i = 1; i < s.steps.length; i++) {
      assert.ok(
        s.steps[i].effectiveL <= s.steps[i - 1].effectiveL + 0.001,
        `L not decreasing at step ${s.steps[i].label}: ${s.steps[i].effectiveL} > ${s.steps[i - 1].effectiveL}`
      );
    }
  });

  it('dark mode steps have monotonically increasing L', () => {
    const s = new Scale('Blue', '#3b82f6');
    for (let i = 1; i < s.darkSteps.length; i++) {
      assert.ok(
        s.darkSteps[i].effectiveL >= s.darkSteps[i - 1].effectiveL - 0.001,
        `L not increasing at step ${s.darkSteps[i].label}: ${s.darkSteps[i].effectiveL} < ${s.darkSteps[i - 1].effectiveL}`
      );
    }
  });
});

describe('WCAG contrast constraints', () => {
  it('all constrained pairs meet requirements (light mode)', () => {
    const s = new Scale('Blue', '#3b82f6');
    for (let i = 0; i < s.steps.length; i++) {
      for (let j = i + 1; j < s.steps.length; j++) {
        const gap = s.steps[j].label - s.steps[i].label;
        const req = getRequiredRatio(gap);
        if (!req) continue;
        const ratio = ColorEngine.contrastRatio(s.steps[i].rgb, s.steps[j].rgb);
        assert.ok(
          ratio >= req - 0.05,
          `Light: steps ${s.steps[i].label}→${s.steps[j].label} (gap ${gap}): ratio ${ratio.toFixed(2)} < required ${req}`
        );
      }
    }
  });

  it('all constrained pairs meet requirements (dark mode)', () => {
    const s = new Scale('Blue', '#3b82f6');
    for (let i = 0; i < s.darkSteps.length; i++) {
      for (let j = i + 1; j < s.darkSteps.length; j++) {
        const gap = s.darkSteps[j].label - s.darkSteps[i].label;
        const req = getRequiredRatio(gap);
        if (!req) continue;
        const ratio = ColorEngine.contrastRatio(s.darkSteps[i].rgb, s.darkSteps[j].rgb);
        assert.ok(
          ratio >= req - 0.05,
          `Dark: steps ${s.darkSteps[i].label}→${s.darkSteps[j].label} (gap ${gap}): ratio ${ratio.toFixed(2)} < required ${req}`
        );
      }
    }
  });

  it('constraints hold for multiple source colors', () => {
    const s = new Scale('Multi', ['#f0a88f', '#ed8461', '#e86235', '#ba4c27']);
    for (let i = 0; i < s.steps.length; i++) {
      for (let j = i + 1; j < s.steps.length; j++) {
        const gap = s.steps[j].label - s.steps[i].label;
        const req = getRequiredRatio(gap);
        if (!req) continue;
        const ratio = ColorEngine.contrastRatio(s.steps[i].rgb, s.steps[j].rgb);
        assert.ok(
          ratio >= req - 0.05,
          `Multi: steps ${s.steps[i].label}→${s.steps[j].label}: ratio ${ratio.toFixed(2)} < required ${req}`
        );
      }
    }
  });
});

describe('addKeyColor / removeKeyColor', () => {
  it('adding a color regenerates correctly', () => {
    const s = new Scale('Test', '#3b82f6');
    assert.equal(s.keyColors.length, 1);
    s.addKeyColor('#ef4444');
    assert.equal(s.keyColors.length, 2);
    assert.equal(s.steps.length, 35);
  });

  it('removing colors down to 1 still works', () => {
    const s = new Scale('Test', ['#3b82f6', '#ef4444']);
    s.removeKeyColor(0);
    assert.equal(s.keyColors.length, 1);
    assert.equal(s.steps.length, 35);
  });

  it('cannot remove the last color', () => {
    const s = new Scale('Test', '#3b82f6');
    s.removeKeyColor(0);
    assert.equal(s.keyColors.length, 1);
  });
});

describe('sampleStep', () => {
  it('returns valid light and dark colors', () => {
    const s = new Scale('Blue', '#3b82f6');
    const sample = s.sampleStep(500);
    assert.ok(sample.light.hex.startsWith('#'));
    assert.ok(sample.dark.hex.startsWith('#'));
    assert.equal(sample.light.rgb.length, 3);
    assert.equal(sample.dark.rgb.length, 3);
  });

  it('step 0 sample has L near 1', () => {
    const s = new Scale('Blue', '#3b82f6');
    const sample = s.sampleStep(0);
    assert.ok(sample.light.oklch.L > 0.95, `expected high L, got ${sample.light.oklch.L}`);
  });
});

describe('exportJSON', () => {
  it('produces valid light/dark structure', () => {
    const s = new Scale('Blue', '#3b82f6');
    const json = s.exportJSON();
    assert.ok(json.light);
    assert.ok(json.dark);
    assert.ok(json.light[0]);
    assert.ok(json.light[900]);
    assert.ok(json.light[0].hex);
    assert.ok(json.light[0].oklch);
    assert.ok(json.light[0].rgb);
  });
});

describe('ScaleManager', () => {
  it('adds and selects scales', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    assert.equal(mgr.scales.length, 1);
    assert.equal(mgr.selectedId, s.id);
  });

  it('duplicates a scale', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    const dup = mgr.duplicateScale(s.id);
    assert.equal(mgr.scales.length, 2);
    assert.equal(dup.name, 'Blue Copy');
    assert.notEqual(dup.id, s.id);
  });

  it('removes a scale and updates selection', () => {
    const mgr = new ScaleManager();
    const s1 = mgr.addScale('A', '#ff0000');
    const s2 = mgr.addScale('B', '#00ff00');
    mgr.removeScale(s2.id);
    assert.equal(mgr.scales.length, 1);
    assert.equal(mgr.selectedId, s1.id);
  });

  it('exportAllCSS produces valid CSS', () => {
    const mgr = new ScaleManager();
    mgr.addScale('Blue', '#3b82f6');
    const css = mgr.exportAllCSS();
    assert.ok(css.includes(':root'));
    assert.ok(css.includes('--blue-'));
    assert.ok(css.includes('prefers-color-scheme: dark'));
  });

  it('exportAllJSON produces valid JSON', () => {
    const mgr = new ScaleManager();
    mgr.addScale('Red', '#ef4444');
    const jsonStr = mgr.exportAllJSON();
    const parsed = JSON.parse(jsonStr);
    assert.ok(parsed['red']);
    assert.ok(parsed['red'].light);
    assert.ok(parsed['red'].dark);
  });
});
