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
  it('returns 7 for gap >= 600', () => {
    assert.equal(getRequiredRatio(600), 7);
    assert.equal(getRequiredRatio(900), 7);
  });

  it('returns 4.5 for gap 500-599', () => {
    assert.equal(getRequiredRatio(500), 4.5);
    assert.equal(getRequiredRatio(550), 4.5);
  });

  it('returns 3 for gap 400-499', () => {
    assert.equal(getRequiredRatio(400), 3);
    assert.equal(getRequiredRatio(490), 3);
  });

  it('returns null for gap < 400', () => {
    assert.equal(getRequiredRatio(390), null);
    assert.equal(getRequiredRatio(0), null);
  });
});

describe('Scale generation', () => {
  it('produces exactly 35 light steps', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    assert.equal(s.steps.length, 35);
  });

  it('produces exactly 35 dark steps', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    assert.equal(s.darkSteps.length, 35);
  });

  it('step 0 is always #FFFFFF in light mode', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    assert.equal(s.steps[0].hex.toUpperCase(), '#FFFFFF');
    assert.equal(s.steps[0].label, 0);
  });

  it('step labels match STEP_LABELS', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Red', '#ef4444');
    const labels = s.steps.map(st => st.label);
    assert.deepEqual(labels, STEP_LABELS);
  });

  it('light mode steps have monotonically decreasing L', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    for (let i = 1; i < s.steps.length; i++) {
      assert.ok(
        s.steps[i].effectiveL <= s.steps[i - 1].effectiveL + 0.001,
        `L not decreasing at step ${s.steps[i].label}: ${s.steps[i].effectiveL} > ${s.steps[i - 1].effectiveL}`
      );
    }
  });

  it('dark mode steps have monotonically increasing L', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
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
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
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
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
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
    const mgr = new ScaleManager();
    const s = mgr.addScale('Multi', ['#f0a88f', '#ed8461', '#e86235', '#ba4c27']);
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
    const mgr = new ScaleManager();
    const s = mgr.addScale('Test', '#3b82f6');
    assert.equal(s.keyColors.length, 1);
    s.addKeyColor('#ef4444');
    assert.equal(s.keyColors.length, 2);
    assert.equal(s.steps.length, 35);
  });

  it('removing colors down to 1 still works', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Test', ['#3b82f6', '#ef4444']);
    s.removeKeyColor(0);
    assert.equal(s.keyColors.length, 1);
    assert.equal(s.steps.length, 35);
  });

  it('cannot remove the last color', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Test', '#3b82f6');
    s.removeKeyColor(0);
    assert.equal(s.keyColors.length, 1);
  });
});

describe('sampleStep', () => {
  it('returns valid light and dark colors', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    const sample = s.sampleStep(500);
    assert.ok(sample.light.hex.startsWith('#'));
    assert.ok(sample.dark.hex.startsWith('#'));
    assert.equal(sample.light.rgb.length, 3);
    assert.equal(sample.dark.rgb.length, 3);
  });

  it('step 0 sample has L near 1', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    const sample = s.sampleStep(0);
    assert.ok(sample.light.oklch.L > 0.95, `expected high L, got ${sample.light.oklch.L}`);
  });
});

describe('exportJSON', () => {
  it('produces valid light/dark structure', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
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

describe('Uniform L schedule', () => {
  it('all steps use linear L from lightnessMax to lightnessMin', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    for (const step of s.steps) {
      if (step.label === 0) continue; // Step 0 is always pure white
      const expectedL = mgr.getLinearL(step.label);
      // desiredL should match the linear schedule exactly
      assert.ok(
        Math.abs(step.desiredL - expectedL) < 0.001,
        `Step ${step.label}: desiredL ${step.desiredL.toFixed(4)} != expected ${expectedL.toFixed(4)}`
      );
    }
  });

  it('L values are identical across different key colors (blue, yellow, purple)', () => {
    const mgr = new ScaleManager();
    const blue = mgr.addScale('Blue', '#2c84db');
    const yellow = mgr.addScale('Yellow', '#faa72a');
    const purple = mgr.addScale('Purple', '#6258d1');

    for (let i = 0; i < blue.steps.length; i++) {
      const bL = blue.steps[i].desiredL;
      const yL = yellow.steps[i].desiredL;
      const pL = purple.steps[i].desiredL;
      assert.ok(
        Math.abs(bL - yL) < 0.001 && Math.abs(bL - pL) < 0.001,
        `Step ${blue.steps[i].label}: Blue L=${bL.toFixed(4)}, Yellow L=${yL.toFixed(4)}, Purple L=${pL.toFixed(4)}`
      );
    }
  });

  it('changing lightnessMax/lightnessMin on manager regenerates all scales', () => {
    const mgr = new ScaleManager();
    const s1 = mgr.addScale('A', '#3b82f6');
    const s2 = mgr.addScale('B', '#ef4444');
    const oldL_s1 = s1.steps[10].desiredL;
    const oldL_s2 = s2.steps[10].desiredL;

    mgr.setLightnessMax(0.9);
    // L values should have changed for both scales
    assert.ok(
      Math.abs(s1.steps[10].desiredL - oldL_s1) > 0.01,
      'Scale 1 should have regenerated after lightnessMax change'
    );
    assert.ok(
      Math.abs(s2.steps[10].desiredL - oldL_s2) > 0.01,
      'Scale 2 should have regenerated after lightnessMax change'
    );
    // Both scales should still have identical L at same step
    assert.ok(
      Math.abs(s1.steps[10].desiredL - s2.steps[10].desiredL) < 0.001,
      'Both scales should have same desiredL after regeneration'
    );
  });

  it('dark mode uses linear L from darkLightnessMin to darkLightnessMax', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    for (const step of s.darkSteps) {
      const expectedL = mgr.getDarkLinearL(step.label);
      assert.ok(
        Math.abs(step.desiredL - expectedL) < 0.001,
        `Dark step ${step.label}: desiredL ${step.desiredL.toFixed(4)} != expected ${expectedL.toFixed(4)}`
      );
    }
  });

  it('WCAG contrast constraints pass with linear L schedule', () => {
    const mgr = new ScaleManager();
    // Test with a challenging hue (blue at high chroma)
    const s = mgr.addScale('DeepBlue', '#0000ff');
    const validation = s.getContrastValidation();
    const failures = validation.constrained.filter(v => !v.pass);
    assert.equal(
      failures.length, 0,
      `${failures.length} WCAG failures: ${failures.map(f => `${f.from}→${f.to}: ${f.ratio.toFixed(2)} < ${f.required}`).join(', ')}`
    );
  });

  it('cross-scale contrast at same step pair differs by < 1.3:1', () => {
    const mgr = new ScaleManager();
    const blue = mgr.addScale('Blue', '#2c84db');
    const yellow = mgr.addScale('Yellow', '#faa72a');
    const purple = mgr.addScale('Purple', '#6258d1');

    const scales = [blue, yellow, purple];
    // Check a few representative step pairs
    const checkPairs = [[0, 450], [0, 500], [450, 900]];
    for (const [fromLabel, toLabel] of checkPairs) {
      const ratios = scales.map(s => {
        const fromStep = s.steps.find(st => st.label === fromLabel);
        const toStep = s.steps.find(st => st.label === toLabel);
        return ColorEngine.contrastRatio(fromStep.rgb, toStep.rgb);
      });
      const maxRatio = Math.max(...ratios);
      const minRatio = Math.min(...ratios);
      // The ratio of ratios should be < 1.3
      assert.ok(
        maxRatio / minRatio < 1.3,
        `Steps ${fromLabel}→${toLabel}: ratios vary too much (${ratios.map(r => r.toFixed(2)).join(', ')}), spread=${(maxRatio/minRatio).toFixed(3)}`
      );
    }
  });
});

describe('ScaleManager serialization', () => {
  it('toConfig includes lightness limits at manager level', () => {
    const mgr = new ScaleManager();
    mgr.addScale('Blue', '#3b82f6');
    const config = mgr.toConfig();
    assert.equal(config.lightnessMax, 1.0);
    assert.equal(config.lightnessMin, 0.15);
    assert.equal(config.darkLightnessMax, 0.95);
    assert.equal(config.darkLightnessMin, 0.15);
    assert.ok(config.scales.length === 1);
    // Scale config should NOT have per-scale limits
    assert.equal(config.scales[0].whiteLimit, undefined);
    assert.equal(config.scales[0].blackLimit, undefined);
  });

  it('Scale.toConfig does not include L curve points', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    const config = s.toConfig();
    assert.ok(config.curvePoints.C);
    assert.ok(config.curvePoints.H);
    assert.equal(config.curvePoints.L, undefined);
  });

  it('fromConfig round-trips correctly', () => {
    const mgr = new ScaleManager();
    mgr.addScale('Blue', '#3b82f6');
    mgr.addScale('Red', '#ef4444');
    mgr.setLightnessMax(0.95);
    mgr.setLightnessMin(0.1);
    const config = mgr.toConfig();

    const mgr2 = new ScaleManager();
    mgr2.fromConfig(config);
    assert.equal(mgr2.lightnessMax, 0.95);
    assert.equal(mgr2.lightnessMin, 0.1);
    assert.equal(mgr2.scales.length, 2);
    assert.equal(mgr2.scales[0].name, 'Blue');
  });

  it('fromConfig handles old config format with per-scale limits', () => {
    // Simulate old config with whiteLimit/blackLimit at manager level
    const oldConfig = {
      whiteLimit: 0.98,
      blackLimit: 0.12,
      darkWhiteLimit: 0.9,
      darkBlackLimit: 0.1,
      scales: [
        { name: 'Blue', keyColors: ['#3b82f6'], curvePoints: { L: [{x:0,y:1},{x:1,y:0.15}], C: [{x:0,y:0},{x:0.5,y:0.15},{x:1,y:0}], H: [{x:0,y:230},{x:1,y:230}] } }
      ],
      selectedId: null
    };
    const mgr = new ScaleManager();
    mgr.fromConfig(oldConfig);
    assert.equal(mgr.lightnessMax, 0.98);
    assert.equal(mgr.lightnessMin, 0.12);
    assert.equal(mgr.darkLightnessMax, 0.9);
    assert.equal(mgr.darkLightnessMin, 0.1);
    assert.equal(mgr.scales.length, 1);
  });
});
