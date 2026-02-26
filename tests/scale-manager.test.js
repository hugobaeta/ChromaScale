const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ColorEngine = require('../color-engine.js');

// Make ColorEngine available globally (Scale/ScaleManager reference it as a global)
globalThis.ColorEngine = ColorEngine;

const {
  Scale, ScaleManager, getRequiredRatio,
  DEFAULT_STEP_LABELS, DEFAULT_MAJOR_DIVISOR, parseStepLabels, formatStepColor
} = require('../scale-manager.js');

describe('DEFAULT_STEP_LABELS', () => {
  it('has exactly 35 entries', () => {
    assert.equal(DEFAULT_STEP_LABELS.length, 35);
  });

  it('starts at 0 and ends at 900', () => {
    assert.equal(DEFAULT_STEP_LABELS[0], 0);
    assert.equal(DEFAULT_STEP_LABELS[DEFAULT_STEP_LABELS.length - 1], 900);
  });

  it('is sorted ascending', () => {
    for (let i = 1; i < DEFAULT_STEP_LABELS.length; i++) {
      assert.ok(DEFAULT_STEP_LABELS[i] > DEFAULT_STEP_LABELS[i - 1]);
    }
  });
});

describe('parseStepLabels', () => {
  it('parses comma-separated integers', () => {
    assert.deepEqual(parseStepLabels('0, 100, 500, 900'), [0, 100, 500, 900]);
  });

  it('handles mixed whitespace and commas', () => {
    assert.deepEqual(parseStepLabels('0  100,500\n900'), [0, 100, 500, 900]);
  });

  it('sorts and de-dupes', () => {
    assert.deepEqual(parseStepLabels('900, 0, 500, 0, 100'), [0, 100, 500, 900]);
  });

  it('rejects missing 0', () => {
    assert.throws(() => parseStepLabels('100, 900'), /start at 0/);
  });

  it('rejects missing 900', () => {
    assert.throws(() => parseStepLabels('0, 500'), /end at 900/);
  });

  it('rejects non-integers and out-of-range', () => {
    assert.throws(() => parseStepLabels('0, 1.5, 900'), /integer/i);
    assert.throws(() => parseStepLabels('0, 1000'), /0.*900/);
    assert.throws(() => parseStepLabels('0, -50, 900'), /0.*900/);
  });

  it('rejects empty', () => {
    assert.throws(() => parseStepLabels(''), /no steps/i);
  });
});

describe('ScaleManager step config', () => {
  it('defaults to DEFAULT_STEP_LABELS and divisor 50', () => {
    const mgr = new ScaleManager();
    assert.deepEqual(mgr.stepLabels, DEFAULT_STEP_LABELS);
    assert.equal(mgr.majorDivisor, 50);
  });

  it('setSteps + regenerate changes step count', () => {
    const mgr = new ScaleManager();
    mgr.addScale('Blue', '#3b82f6');
    mgr.setSteps('0, 100, 200, 300, 400, 500, 600, 700, 800, 900');
    mgr.regenerateAll();
    assert.equal(mgr.scales[0].steps.length, 10);
    assert.deepEqual(mgr.scales[0].steps.map(s => s.label), [0,100,200,300,400,500,600,700,800,900]);
  });

  it('isMajor respects divisor', () => {
    const mgr = new ScaleManager();
    mgr.setMajorDivisor(100);
    assert.ok(mgr.isMajor(0));
    assert.ok(mgr.isMajor(100));
    assert.ok(!mgr.isMajor(50));
    assert.ok(!mgr.isMajor(150));
  });

  it('snapStep finds nearest defined step', () => {
    const mgr = new ScaleManager();
    mgr.setSteps([0, 100, 500, 900]);
    assert.equal(mgr.snapStep(250, 1), 500);  // ceil
    assert.equal(mgr.snapStep(250, -1), 100); // floor
    assert.equal(mgr.snapStep(100, 1), 100);  // exact
    assert.equal(mgr.snapStep(950, 1), 900);  // clamp
    assert.equal(mgr.snapStep(-5, -1), 0);    // clamp
  });

  it('toConfig/fromConfig round-trips step config', () => {
    const mgr = new ScaleManager();
    mgr.addScale('X', '#888888');
    mgr.setSteps('0, 50, 500, 850, 900');
    mgr.setMajorDivisor(25);
    const cfg = mgr.toConfig();

    const mgr2 = new ScaleManager();
    mgr2.fromConfig(cfg);
    assert.deepEqual(mgr2.stepLabels, [0, 50, 500, 850, 900]);
    assert.equal(mgr2.majorDivisor, 25);
    assert.equal(mgr2.scales[0].steps.length, 5);
  });

  it('fromConfig without step fields uses defaults', () => {
    const mgr = new ScaleManager();
    mgr.fromConfig({
      lightnessMax: 1, lightnessMin: 0.15,
      scales: [{ name: 'X', keyColors: ['#888888'] }]
    });
    assert.deepEqual(mgr.stepLabels, DEFAULT_STEP_LABELS);
    assert.equal(mgr.majorDivisor, DEFAULT_MAJOR_DIVISOR);
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
  it('produces exactly 35 steps', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    assert.equal(s.steps.length, 35);
  });

  it('step 0 is always #FFFFFF', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    assert.equal(s.steps[0].hex.toUpperCase(), '#FFFFFF');
    assert.equal(s.steps[0].label, 0);
  });

  it('step labels match manager.stepLabels', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Red', '#ef4444');
    const labels = s.steps.map(st => st.label);
    assert.deepEqual(labels, mgr.stepLabels);
  });

  it('steps have monotonically decreasing L', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    for (let i = 1; i < s.steps.length; i++) {
      assert.ok(
        s.steps[i].effectiveL <= s.steps[i - 1].effectiveL + 0.001,
        `L not decreasing at step ${s.steps[i].label}: ${s.steps[i].effectiveL} > ${s.steps[i - 1].effectiveL}`
      );
    }
  });
});

describe('WCAG contrast constraints', () => {
  it('all constrained pairs meet requirements', () => {
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
          `Steps ${s.steps[i].label}→${s.steps[j].label} (gap ${gap}): ratio ${ratio.toFixed(2)} < required ${req}`
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
  it('returns valid color', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    const sample = s.sampleStep(500);
    assert.ok(sample.hex.startsWith('#'));
    assert.equal(sample.rgb.length, 3);
    assert.ok(sample.oklch);
  });

  it('step 0 sample has L near 1', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    const sample = s.sampleStep(0);
    assert.ok(sample.oklch.L > 0.95, `expected high L, got ${sample.oklch.L}`);
  });
});

describe('exportJSON', () => {
  it('produces valid flat structure', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('Blue', '#3b82f6');
    const json = s.exportJSON();
    assert.ok(json[0]);
    assert.ok(json[900]);
    assert.ok(json[0].hex);
    assert.ok(json[0].oklch);
    assert.ok(json[0].rgb);
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
  });

  it('exportAllCSS respects color format', () => {
    const mgr = new ScaleManager();
    mgr.addScale('Blue', '#3b82f6');
    assert.ok(mgr.exportAllCSS('hex').includes('#'));
    assert.ok(mgr.exportAllCSS('rgb').includes('rgb('));
    assert.ok(mgr.exportAllCSS('hsl').includes('hsl('));
    assert.ok(mgr.exportAllCSS('oklch').includes('oklch('));
  });

  it('formatStepColor produces well-formed strings for each format', () => {
    const mgr = new ScaleManager();
    const s = mgr.addScale('X', '#2c84db');
    const step = s.steps.find(st => st.label === 500);

    assert.match(formatStepColor(step, 'hex'), /^#[0-9A-Fa-f]{6}$/);
    assert.match(formatStepColor(step, 'rgb'), /^rgb\(\d+ \d+ \d+\)$/);
    assert.match(formatStepColor(step, 'hsl'), /^hsl\(\d+ \d+% \d+%\)$/);
    assert.match(formatStepColor(step, 'oklch'), /^oklch\(0\.\d+ 0\.\d+ \d+\.\d+\)$/);
  });

  it('formatStepColor HSL is close to expected for known inputs', () => {
    // pure white → HSL(0 0% 100%)
    const white = { rgb: [255, 255, 255], hex: '#FFFFFF', oklch: { L: 1, C: 0, H: 0 } };
    assert.equal(formatStepColor(white, 'hsl'), 'hsl(0 0% 100%)');
    // pure red → HSL(0 100% 50%)
    const red = { rgb: [255, 0, 0], hex: '#FF0000', oklch: { L: 0.63, C: 0.26, H: 29 } };
    assert.equal(formatStepColor(red, 'hsl'), 'hsl(0 100% 50%)');
  });

  it('exportAllJSON produces valid JSON', () => {
    const mgr = new ScaleManager();
    mgr.addScale('Red', '#ef4444');
    const jsonStr = mgr.exportAllJSON();
    const parsed = JSON.parse(jsonStr);
    assert.ok(parsed['red']);
    assert.ok(parsed['red'][0]);
    assert.ok(parsed['red'][900]);
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

  it('fromConfig handles old config format with legacy limit names', () => {
    // Simulate old config with whiteLimit/blackLimit at manager level
    const oldConfig = {
      whiteLimit: 0.98,
      blackLimit: 0.12,
      scales: [
        { name: 'Blue', keyColors: ['#3b82f6'], curvePoints: { L: [{x:0,y:1},{x:1,y:0.15}], C: [{x:0,y:0},{x:0.5,y:0.15},{x:1,y:0}], H: [{x:0,y:230},{x:1,y:230}] } }
      ],
      selectedId: null
    };
    const mgr = new ScaleManager();
    mgr.fromConfig(oldConfig);
    assert.equal(mgr.lightnessMax, 0.98);
    assert.equal(mgr.lightnessMin, 0.12);
    assert.equal(mgr.scales.length, 1);
  });
});
