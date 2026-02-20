// ChromaScale — OKLCH Color Engine
// Full OKLCH ↔ sRGB pipeline, contrast ratios, gamut clamping, spline interpolation

const ColorEngine = (() => {

  // === sRGB ↔ Linear RGB ===
  function srgbToLinear(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    c = Math.max(0, Math.min(1, c));
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  // === Hex ↔ RGB ===
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return [
      parseInt(hex.substring(0, 2), 16),
      parseInt(hex.substring(2, 4), 16),
      parseInt(hex.substring(4, 6), 16)
    ];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(c => {
      const v = Math.round(Math.max(0, Math.min(255, c)));
      return v.toString(16).padStart(2, '0');
    }).join('');
  }

  // === Linear RGB ↔ OKLab ===
  function linearRgbToOklab(r, g, b) {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2220049256 * g + 0.6896926220 * b;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return {
      L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
  }

  function oklabToLinearRgb(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    return [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }

  // === OKLab ↔ OKLCH ===
  function oklabToOklch(L, a, b) {
    const C = Math.sqrt(a * a + b * b);
    let H = Math.atan2(b, a) * 180 / Math.PI;
    if (H < 0) H += 360;
    return { L, C, H };
  }

  function oklchToOklab(L, C, H) {
    const hRad = H * Math.PI / 180;
    return {
      L,
      a: C * Math.cos(hRad),
      b: C * Math.sin(hRad)
    };
  }

  // === High-level conversions ===
  function hexToOklch(hex) {
    const [r, g, b] = hexToRgb(hex);
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);
    const lab = linearRgbToOklab(lr, lg, lb);
    return oklabToOklch(lab.L, lab.a, lab.b);
  }

  function oklchToHex(L, C, H) {
    const lab = oklchToOklab(L, C, H);
    const [lr, lg, lb] = oklabToLinearRgb(lab.L, lab.a, lab.b);
    const r = Math.round(linearToSrgb(lr) * 255);
    const g = Math.round(linearToSrgb(lg) * 255);
    const b = Math.round(linearToSrgb(lb) * 255);
    return rgbToHex([r, g, b]);
  }

  function oklchToRgb(L, C, H) {
    const lab = oklchToOklab(L, C, H);
    const [lr, lg, lb] = oklabToLinearRgb(lab.L, lab.a, lab.b);
    return [
      Math.round(linearToSrgb(lr) * 255),
      Math.round(linearToSrgb(lg) * 255),
      Math.round(linearToSrgb(lb) * 255)
    ];
  }

  // === Gamut checking ===
  function isInGamut(L, C, H) {
    const lab = oklchToOklab(L, C, H);
    const [r, g, b] = oklabToLinearRgb(lab.L, lab.a, lab.b);
    const eps = 0.001;
    return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
  }

  function clampToGamut(L, C, H) {
    if (isInGamut(L, C, H)) return { L, C, H, clamped: false };
    
    let lo = 0, hi = C;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (isInGamut(L, mid, H)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return { L, C: lo, H, clamped: true };
  }

  // === Contrast ratio (WCAG 2.x) ===
  function relativeLuminance(r, g, b) {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  }

  function contrastRatio(rgb1, rgb2) {
    const l1 = relativeLuminance(...rgb1);
    const l2 = relativeLuminance(...rgb2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // === Spline interpolation (Catmull-Rom style) ===
  // Points: array of {x, y} sorted by x
  function cubicHermiteInterpolate(points, x) {
    if (points.length === 0) return 0;
    if (points.length === 1) return points[0].y;
    
    // Clamp to range
    if (x <= points[0].x) return points[0].y;
    if (x >= points[points.length - 1].x) return points[points.length - 1].y;

    // Find segment
    let i = 0;
    for (let j = 0; j < points.length - 1; j++) {
      if (x >= points[j].x && x <= points[j + 1].x) { i = j; break; }
    }

    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const dx = p2.x - p1.x;
    if (dx === 0) return p1.y;
    const t = (x - p1.x) / dx;

    // Catmull-Rom tangents
    const tension = 0.5;
    let m1, m2;
    
    if (i === 0) {
      m1 = (p2.y - p1.y);
    } else {
      m1 = tension * (p2.y - p0.y) * dx / (p2.x - p0.x);
    }
    
    if (i === points.length - 2) {
      m2 = (p2.y - p1.y);
    } else {
      m2 = tension * (p3.y - p1.y) * dx / (p3.x - p1.x);
    }

    // Hermite basis
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return h00 * p1.y + h10 * m1 + h01 * p2.y + h11 * m2;
  }

  // Interpolate with hue wrapping (circular)
  function interpolateHue(points, x) {
    if (points.length <= 1) return points.length ? points[0].y : 0;
    
    // Unwrap hues
    const unwrapped = [{ x: points[0].x, y: points[0].y }];
    for (let i = 1; i < points.length; i++) {
      let h = points[i].y;
      const prev = unwrapped[i - 1].y;
      while (h - prev > 180) h -= 360;
      while (prev - h > 180) h += 360;
      unwrapped.push({ x: points[i].x, y: h });
    }

    let result = cubicHermiteInterpolate(unwrapped, x);
    // Wrap back to [0, 360)
    result = ((result % 360) + 360) % 360;
    return result;
  }

  // === Public API ===
  return {
    hexToRgb,
    rgbToHex,
    hexToOklch,
    oklchToHex,
    oklchToRgb,
    isInGamut,
    clampToGamut,
    relativeLuminance,
    contrastRatio,
    cubicHermiteInterpolate,
    interpolateHue
  };
})();

if (typeof module !== 'undefined') module.exports = ColorEngine;
