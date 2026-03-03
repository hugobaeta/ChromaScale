// ChromaScale — Curve Editor v5
// Canvas-based C/H curve editor with L as non-interactive reference line.
// v5: Curve points ARE key colors. C and H curves share interior points —
// dragging one curve's point moves the paired point on the other curve in X.
// Add/remove operations affect both curves simultaneously.

class CurveEditor {
  // callbacks = {
  //   onMovePoint: (interiorIdx, x, cY, hY) => {L, C, H}  — returns clamped LCH for snap-back
  //   onAddPoint:  (x) => newInteriorIdx                  — returns index in sorted keyColors
  //   onRemovePoint: (interiorIdx) => void
  //   onDragEnd: () => void                               — save trigger
  // }
  // interiorIdx = curve point index − 1 (endpoint at index 0 isn't a key color)
  constructor(container, callbacks) {
    this.container = container;
    this.callbacks = callbacks || {};
    this.canvas = document.createElement('canvas');
    this.ctx = null;
    this.dpr = window.devicePixelRatio || 1;

    this.gradientH = 100;
    this.padding = { top: 20 + 100 + 8, right: 24, bottom: 32, left: 44 };
    this.width = 0;
    this.height = 0;

    this.channels = {
      L: { color: '#555', label: 'Lightness', min: 0, max: 1, points: [], interactive: false },
      C: { color: '#D97757', label: 'Chroma', min: 0, max: 0.4, points: [], interactive: true },
      H: { color: '#6A9BCC', label: 'Hue', min: 0, max: 360, points: [], interactive: true }
    };

    // Constraint boundaries for L curve
    this.constraintBounds = []; // [{t, minL, maxL}]

    // Step labels for snap-to-step on release
    this.stepLabels = null; // e.g. [0, 50, 100, ..., 900]
    // Lightness endpoints (for gamut snap-back x calculation)
    this.lMax = 1.0;
    this.lMin = 0.15;

    this.dragging = null;
    this.hoveredChannel = null;
    this.hoveredIndex = -1;
    this.highlightT = null; // Highlighted t position from swatch row
    this._cachedTheme = null;
    this._themeInvalid = true;

    this._setupCanvas();
    this._bindEvents();
  }

  _setupCanvas() {
    this.canvas.style.inlineSize = '100%';
    this.canvas.style.blockSize = '528px';
    this.canvas.style.cursor = 'crosshair';
    this.canvas.style.borderRadius = '6px';
    this.canvas.className = 'curve-canvas';
    this.container.appendChild(this.canvas);

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  // Read current theme colors from CSS variables (cached, invalidate on theme change)
  _getThemeColors() {
    if (!this._themeInvalid && this._cachedTheme) return this._cachedTheme;
    const root = document.documentElement;
    const get = (v) => getComputedStyle(root).getPropertyValue(v).trim();
    this._cachedTheme = {
      bg: get('--bg-subtle') || '#fafafa',
      border: get('--border') || '#e2e2e2',
      gridLine: get('--border') || '#eee',
      axisLabel: get('--text-muted') || '#999',
      pointFill: get('--bg') || '#fff',
      hoverLabel: get('--text') || '#333',
    };
    this._themeInvalid = false;
    return this._cachedTheme;
  }

  invalidateTheme() {
    this._themeInvalid = true;
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(this.dpr, this.dpr);
    this.draw();
  }

  _toPixel(x, yNorm) {
    const p = this.padding;
    const w = this.width - p.left - p.right;
    const h = this.height - p.top - p.bottom;
    return { px: p.left + x * w, py: p.top + (1 - yNorm) * h };
  }

  _fromPixel(px, py) {
    const p = this.padding;
    const w = this.width - p.left - p.right;
    const h = this.height - p.top - p.bottom;
    return {
      x: Math.max(0, Math.min(1, (px - p.left) / w)),
      yNorm: Math.max(0, Math.min(1, 1 - (py - p.top) / h))
    };
  }

  _normalize(channel, value) {
    const ch = this.channels[channel];
    return (value - ch.min) / (ch.max - ch.min);
  }

  _denormalize(channel, norm) {
    const ch = this.channels[channel];
    return ch.min + norm * (ch.max - ch.min);
  }

  setPoints(channel, points) {
    this.channels[channel].points = points.map(p => ({ ...p })).sort((a, b) => a.x - b.x);
    this.draw();
  }

  getPoints(channel) {
    return this.channels[channel].points.map(p => ({ ...p }));
  }

  // Step labels for snap-to-step on drag release
  setStepLabels(labels) {
    this.stepLabels = labels ? [...labels] : null;
  }

  // Lightness endpoints (for gamut snap-back reverse-mapping)
  setLightnessRange(lMax, lMin) {
    this.lMax = lMax;
    this.lMin = lMin;
  }

  // Set constraint bounds to visualize on L curve
  setConstraintBounds(bounds) {
    this.constraintBounds = bounds;
    this.draw();
  }

  setHighlightT(t) {
    this.highlightT = t;
    this.draw();
    clearTimeout(this._highlightTimer);
    this._highlightTimer = setTimeout(() => {
      this.highlightT = null;
      this.draw();
    }, 3000);
  }

  getValue(channel, x) {
    const pts = this.channels[channel].points;
    if (pts.length === 0) return 0;
    if (channel === 'H') return ColorEngine.interpolateHue(pts, x);
    // For L (reference line with only 2 points), linear interpolation is fine
    if (!this.channels[channel].interactive && pts.length === 2) {
      const t = Math.max(0, Math.min(1, (x - pts[0].x) / (pts[1].x - pts[0].x || 1)));
      return pts[0].y + t * (pts[1].y - pts[0].y);
    }
    return ColorEngine.cubicHermiteInterpolate(pts, x);
  }

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this._drawGradientBackground(ctx);
    this._drawGrid(ctx);
    this._drawConstraintBands(ctx);

    // Draw L first (behind interactive curves), then C and H
    this._drawCurve(ctx, 'L');
    for (const ch of ['H', 'C']) this._drawCurve(ctx, ch);
    // Paired-point link line (vertical hairline between matched C/H points)
    this._drawPairedLink(ctx);
    // Only draw points for interactive channels
    for (const ch of ['H', 'C']) this._drawPoints(ctx, ch);
    if (this.highlightT !== null) this._drawHighlightMarkers(ctx);
  }

  _drawGrid(ctx) {
    const p = this.padding;
    const w = this.width - p.left - p.right;
    const h = this.height - p.top - p.bottom;
    const theme = this._getThemeColors();

    ctx.strokeStyle = theme.gridLine;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
      const y = p.top + (i / 4) * h;
      ctx.beginPath();
      ctx.moveTo(p.left, y);
      ctx.lineTo(p.left + w, y);
      ctx.stroke();
    }

    for (let i = 0; i <= 10; i++) {
      const x = p.left + (i / 10) * w;
      ctx.beginPath();
      ctx.moveTo(x, p.top);
      ctx.lineTo(x, p.top + h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = theme.axisLabel;
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'center';

    const xLabels = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    xLabels.forEach(label => {
      const t = label / 900;
      const x = p.left + t * w;
      ctx.fillText(label.toString(), x, p.top + h + 14);
    });

    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = p.top + (i / 4) * h;
      ctx.fillText(((4 - i) / 4).toFixed(2), p.left - 6, y + 3);
    }
  }

  _drawConstraintBands(ctx) {
    if (!this.constraintBounds.length) return;

    const p = this.padding;
    const w = this.width - p.left - p.right;
    const h = this.height - p.top - p.bottom;

    ctx.fillStyle = 'rgba(220, 38, 38, 0.06)';
    ctx.beginPath();

    const sorted = [...this.constraintBounds].sort((a, b) => a.t - b.t);

    ctx.strokeStyle = 'rgba(220, 38, 38, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    ctx.beginPath();
    sorted.forEach((b, i) => {
      const x = p.left + b.t * w;
      const y = p.top + (1 - b.maxL) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.beginPath();
    sorted.forEach((b, i) => {
      const x = p.left + b.t * w;
      const y = p.top + (1 - b.minL) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(220, 38, 38, 0.04)';
    ctx.beginPath();
    ctx.moveTo(p.left + sorted[0].t * w, p.top);
    sorted.forEach(b => {
      const x = p.left + b.t * w;
      const y = p.top + (1 - b.maxL) * h;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(p.left + sorted[sorted.length - 1].t * w, p.top);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(p.left + sorted[0].t * w, p.top + h);
    sorted.forEach(b => {
      const x = p.left + b.t * w;
      const y = p.top + (1 - b.minL) * h;
      ctx.lineTo(x, y);
    });
    ctx.lineTo(p.left + sorted[sorted.length - 1].t * w, p.top + h);
    ctx.closePath();
    ctx.fill();
  }

  _drawGradientBackground(ctx) {
    const p = this.padding;
    const w = this.width - p.left - p.right;
    const gH = this.gradientH;
    const gY = 20; // original top padding before gradient space

    const steps = 100;
    const stepW = w / steps;

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const L = this.getValue('L', t);
      const C = this.getValue('C', t);
      const H = this.getValue('H', t);
      const clamped = ColorEngine.clampToGamut(
        Math.max(0, Math.min(1, L)),
        Math.max(0, C),
        ((H % 360) + 360) % 360
      );
      const hex = ColorEngine.oklchToHex(clamped.L, clamped.C, clamped.H);
      ctx.fillStyle = hex;
      ctx.fillRect(p.left + i * stepW, gY, stepW + 1, gH);
    }

    // Border around gradient strip
    const theme = this._getThemeColors();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.left, gY, w, gH);
  }

  _drawCurve(ctx, channel) {
    const ch = this.channels[channel];
    if (ch.points.length < 2) return;

    const isReference = !ch.interactive;
    const isHovered = this.hoveredChannel === channel;

    if (isReference) {
      // L reference line: dashed, dimmer, thinner
      ctx.strokeStyle = ch.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([6, 4]);
    } else {
      ctx.strokeStyle = ch.color;
      ctx.lineWidth = isHovered ? 2.5 : 1.5;
      ctx.globalAlpha = isHovered ? 1 : 0.7;
    }

    ctx.beginPath();
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
      const x = i / steps;
      const val = this.getValue(channel, x);
      const norm = this._normalize(channel, val);
      const { px, py } = this._toPixel(x, Math.max(0, Math.min(1, norm)));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (isReference) ctx.setLineDash([]);

    // Draw curve label at right edge
    const endVal = this.getValue(channel, 1);
    const endNorm = this._normalize(channel, endVal);
    const { py: labelY } = this._toPixel(1, Math.max(0, Math.min(1, endNorm)));
    ctx.fillStyle = ch.color;
    ctx.globalAlpha = isReference ? 0.4 : 0.85;
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    const p = this.padding;
    ctx.fillText(channel, this.width - p.right + 4, labelY + 3);
    ctx.globalAlpha = 1;
  }

  // Draw a subtle vertical hairline connecting paired C/H points at the
  // hovered/dragged index. Also draws a hollow ring on the paired point.
  _drawPairedLink(ctx) {
    const idx = this.dragging ? this.dragging.index : (this.hoveredIndex >= 0 ? this.hoveredIndex : -1);
    if (idx < 0) return;
    const activeCh = this.dragging ? this.dragging.channel : this.hoveredChannel;
    if (activeCh !== 'C' && activeCh !== 'H') return;

    const cPts = this.channels.C.points;
    const hPts = this.channels.H.points;
    if (idx >= cPts.length || idx >= hPts.length) return;
    // Endpoints (first/last) don't have pairs worth highlighting
    if (idx === 0 || idx === cPts.length - 1) return;

    const cPt = cPts[idx];
    const hPt = hPts[idx];
    const cNorm = this._normalize('C', cPt.y);
    const hNorm = this._normalize('H', hPt.y);
    const { px: cPx, py: cPy } = this._toPixel(cPt.x, Math.max(0, Math.min(1, cNorm)));
    const { px: hPx, py: hPy } = this._toPixel(hPt.x, Math.max(0, Math.min(1, hNorm)));

    const theme = this._getThemeColors();

    // Vertical hairline between the two points (they share x, so cPx ≈ hPx)
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = theme.hoverLabel || '#888';
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cPx, Math.min(cPy, hPy));
    ctx.lineTo(cPx, Math.max(cPy, hPy));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Hollow ring on the paired (non-active) channel's point
    const pairedCh = activeCh === 'C' ? 'H' : 'C';
    const pairedPx = pairedCh === 'C' ? cPx : hPx;
    const pairedPy = pairedCh === 'C' ? cPy : hPy;
    ctx.beginPath();
    ctx.arc(pairedPx, pairedPy, 8, 0, Math.PI * 2);
    ctx.strokeStyle = this.channels[pairedCh].color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  _drawPoints(ctx, channel) {
    const ch = this.channels[channel];
    if (!ch.interactive) return; // Skip drawing points for non-interactive channels
    const theme = this._getThemeColors();
    ch.points.forEach((pt, idx) => {
      const norm = this._normalize(channel, pt.y);
      const { px, py } = this._toPixel(pt.x, Math.max(0, Math.min(1, norm)));
      const isHovered = this.hoveredChannel === channel && this.hoveredIndex === idx;
      const isDragging = this.dragging && this.dragging.channel === channel && this.dragging.index === idx;

      const radius = isDragging ? 7 : isHovered ? 6 : 4.5;

      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = theme.pointFill;
      ctx.fill();
      ctx.strokeStyle = ch.color;
      ctx.lineWidth = isDragging ? 2.5 : 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fillStyle = ch.color;
      ctx.fill();

      if (isHovered || isDragging) {
        const label = channel === 'H' ? `${pt.y.toFixed(0)}°` : pt.y.toFixed(3);
        ctx.fillStyle = theme.hoverLabel;
        ctx.font = '10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, px, py - radius - 6);
      }
    });
  }

  _drawHighlightMarkers(ctx) {
    const t = this.highlightT;
    const theme = this._getThemeColors();

    const p = this.padding;
    const plotW = this.width - p.left - p.right;
    const plotH = this.height - p.top - p.bottom;
    const lineX = p.left + t * plotW;

    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = theme.hoverLabel || '#888';
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lineX, p.top);
    ctx.lineTo(lineX, p.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();

    // Show highlight markers on all channels (including L as read-only display)
    for (const chName of ['L', 'C', 'H']) {
      const ch = this.channels[chName];
      if (ch.points.length === 0) continue;

      const value = this.getValue(chName, t);
      const norm = this._normalize(chName, value);
      const { px, py } = this._toPixel(t, Math.max(0, Math.min(1, norm)));

      // Outer focus ring
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.strokeStyle = ch.color;
      ctx.globalAlpha = ch.interactive ? 0.35 : 0.2;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Inner ring
      ctx.beginPath();
      ctx.arc(px, py, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = theme.pointFill || '#fff';
      ctx.fill();
      ctx.strokeStyle = ch.color;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = ch.interactive ? 1 : 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Center dot
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = ch.color;
      ctx.globalAlpha = ch.interactive ? 1 : 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Value label
      const label = chName === 'H' ? `${value.toFixed(0)}°` : value.toFixed(3);
      ctx.fillStyle = ch.color;
      ctx.globalAlpha = ch.interactive ? 1 : 0.5;
      ctx.font = 'bold 10px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, px, py - 14);
      ctx.globalAlpha = 1;
    }
  }

  _findNearestPoint(px, py, threshold) {
    let best = null;
    let bestDist = threshold || 16;

    for (const chName of ['C', 'H']) { // Exclude L from hit-testing
      const ch = this.channels[chName];
      ch.points.forEach((pt, idx) => {
        const norm = this._normalize(chName, pt.y);
        const { px: ptPx, py: ptPy } = this._toPixel(pt.x, Math.max(0, Math.min(1, norm)));
        const dist = Math.sqrt((px - ptPx) ** 2 + (py - ptPy) ** 2);
        if (dist < bestDist) {
          bestDist = dist;
          best = { channel: chName, index: idx, dist };
        }
      });
    }
    return best;
  }

  _findNearestCurve(px, py) {
    const { x } = this._fromPixel(px, py);
    let best = null;
    let bestDist = 30;

    for (const chName of ['C', 'H']) { // Exclude L from hit-testing
      const val = this.getValue(chName, x);
      const norm = this._normalize(chName, val);
      const { py: curvePy } = this._toPixel(x, Math.max(0, Math.min(1, norm)));
      const dist = Math.abs(py - curvePy);
      if (dist < bestDist) {
        bestDist = dist;
        best = chName;
      }
    }
    return best;
  }

  _isEndpoint(idx) {
    const n = this.channels.C.points.length;
    return idx === 0 || idx === n - 1;
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.canvas.addEventListener('mouseleave', () => this._onMouseLeave());
    this.canvas.addEventListener('dblclick', (e) => this._onDoubleClick(e));
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._onRightClick(e);
    });
  }

  _getMousePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    if (this.highlightT !== null) {
      this.highlightT = null;
      clearTimeout(this._highlightTimer);
    }
    const { px, py } = this._getMousePos(e);
    this._mouseDownPos = { px, py };
    this._didDrag = false;
    const nearest = this._findNearestPoint(px, py, 14);

    if (nearest) {
      // Grabbed an existing point — start dragging it
      this.dragging = { channel: nearest.channel, index: nearest.index };
      this.canvas.style.cursor = 'grabbing';
    } else {
      // Clicked on a curve — add a new key color at this x position.
      // The callback updates keyColors, then the app reloads both channels'
      // points via setPoints(). We then grab the new interior point.
      const nearestCurve = this._findNearestCurve(px, py);
      if (nearestCurve && this.callbacks.onAddPoint) {
        const { x } = this._fromPixel(px, py);
        // Clamp x away from exact endpoints (keyColors can't have L = exact lMax/lMin)
        const clampedX = Math.max(0.02, Math.min(0.98, x));
        const interiorIdx = this.callbacks.onAddPoint(clampedX);
        // App has called setPoints() by now. Map interior idx → point idx.
        const pointIdx = interiorIdx + 1;
        if (pointIdx > 0 && pointIdx < this.channels.C.points.length - 1) {
          this.dragging = { channel: nearestCurve, index: pointIdx };
          this.canvas.style.cursor = 'grabbing';
        }
        this.draw();
      }
    }
  }

  _onMouseMove(e) {
    const { px, py } = this._getMousePos(e);

    if (this.dragging) {
      this._didDrag = true;
      const { x, yNorm } = this._fromPixel(px, py);
      const idx = this.dragging.index;
      const activeCh = this.dragging.channel;
      const cPts = this.channels.C.points;
      const hPts = this.channels.H.points;

      // Interior points: update X on BOTH channels (paired). Y only on active.
      // Endpoints: X is fixed; only Y moves (but endpoints aren't grabbable
      // in practice — they're not key colors).
      if (!this._isEndpoint(idx)) {
        const prevX = idx > 0 ? cPts[idx - 1].x + 0.005 : 0.02;
        const nextX = idx < cPts.length - 1 ? cPts[idx + 1].x - 0.005 : 0.98;
        const newX = Math.round(Math.max(prevX, Math.min(nextX, x)) * 1000) / 1000;
        cPts[idx].x = newX;
        hPts[idx].x = newX;
      }

      // Y on active channel only
      const ch = this.channels[activeCh];
      const pt = ch.points[idx];
      let newY = this._denormalize(activeCh, yNorm);
      const yPrec = activeCh === 'H' ? 10 : 1000;
      newY = Math.round(Math.max(ch.min, Math.min(ch.max, newY)) * yPrec) / yPrec;
      pt.y = newY;

      this.draw();
      this._notifyMove(idx);
    } else {
      const nearest = this._findNearestPoint(px, py, 14);
      if (nearest) {
        this.hoveredChannel = nearest.channel;
        this.hoveredIndex = nearest.index;
        this.canvas.style.cursor = 'grab';
      } else {
        this.hoveredIndex = -1;
        this.hoveredChannel = this._findNearestCurve(px, py);
        this.canvas.style.cursor = 'crosshair';
      }
      this.draw();
    }
  }

  _onMouseUp(e) {
    if (this.dragging && this._mouseDownPos) {
      const { px, py } = this._getMousePos(e);
      const dx = px - this._mouseDownPos.px;
      const dy = py - this._mouseDownPos.py;
      const wasClick = Math.sqrt(dx * dx + dy * dy) < 3 && !this._didDrag;

      if (wasClick && !this._isEndpoint(this.dragging.index)) {
        // Click without drag on an interior point — show Y value editor
        const ch = this.channels[this.dragging.channel];
        const pt = ch.points[this.dragging.index];
        this._showPointEditor(this.dragging.channel, this.dragging.index, pt);
      } else if (this._didDrag && !this._isEndpoint(this.dragging.index)) {
        // Drag released on an interior point — snap-to-step, then gamut snap-back
        const idx = this.dragging.index;
        this._applySnapToStep(idx);
        this._applyGamutSnapBack(idx);
        if (this.callbacks.onDragEnd) this.callbacks.onDragEnd();
      } else if (this._didDrag && this.callbacks.onDragEnd) {
        this.callbacks.onDragEnd();
      }
    }
    this.dragging = null;
    this._mouseDownPos = null;
    this._didDrag = false;
    this.canvas.style.cursor = 'crosshair';
  }

  // Snap X to nearest step label if within threshold
  _applySnapToStep(idx) {
    if (!this.stepLabels || this.stepLabels.length === 0) return;
    const cPts = this.channels.C.points;
    const hPts = this.channels.H.points;
    const curX = cPts[idx].x;
    const stepTs = this.stepLabels.map(s => s / 900);
    let nearest = stepTs[0];
    for (const t of stepTs) {
      if (Math.abs(t - curX) < Math.abs(nearest - curX)) nearest = t;
    }
    // Threshold ≈ ±1 step at 35-step density
    if (Math.abs(nearest - curX) < 0.012) {
      // Clamp to interior range (don't snap to exact 0 or 1)
      const snapped = Math.max(0.02, Math.min(0.98, nearest));
      cPts[idx].x = snapped;
      hPts[idx].x = snapped;
      this._notifyMove(idx);
      this.draw();
    }
  }

  // After drag release, ask the app to gamut-clamp and reverse-map the
  // stored LCH back to curve coordinates so the point visually reflects
  // what's actually stored.
  _applyGamutSnapBack(idx) {
    if (!this.callbacks.onMovePoint) return;
    const cPts = this.channels.C.points;
    const hPts = this.channels.H.points;
    const clamped = this.callbacks.onMovePoint(
      idx - 1, cPts[idx].x, cPts[idx].y, hPts[idx].y
    );
    if (!clamped || clamped.L == null) return;
    // Reverse: L → x via linear schedule; C/H direct
    const lRange = this.lMax - this.lMin;
    const newX = lRange <= 0 ? 0.5 : Math.max(0.02, Math.min(0.98, (this.lMax - clamped.L) / lRange));
    cPts[idx].x = newX;
    hPts[idx].x = newX;
    cPts[idx].y = Math.max(this.channels.C.min, Math.min(this.channels.C.max, clamped.C));
    hPts[idx].y = ((clamped.H % 360) + 360) % 360;
    this.draw();
  }

  _onMouseLeave() {
    // If dragging, treat as drag-end so we don't leave state half-applied
    if (this.dragging && this._didDrag && !this._isEndpoint(this.dragging.index)) {
      const idx = this.dragging.index;
      this._applySnapToStep(idx);
      this._applyGamutSnapBack(idx);
      if (this.callbacks.onDragEnd) this.callbacks.onDragEnd();
    }
    this.dragging = null;
    this.hoveredChannel = null;
    this.hoveredIndex = -1;
    this._didDrag = false;
    this.canvas.style.cursor = 'crosshair';
    this.draw();
  }

  _onDoubleClick(e) { this._onRightClick(e); }

  _onRightClick(e) {
    const { px, py } = this._getMousePos(e);
    const nearest = this._findNearestPoint(px, py, 14);
    if (!nearest) return;

    // Can't remove endpoints, or the last remaining key color
    if (this._isEndpoint(nearest.index)) return;
    const n = this.channels.C.points.length;
    if (n <= 3) return; // 3 points = 2 endpoints + 1 key color (min)

    // Paired remove — callback removes the key color, app reloads both channels
    if (this.callbacks.onRemovePoint) {
      this.callbacks.onRemovePoint(nearest.index - 1);
    }
    this.hoveredChannel = null;
    this.hoveredIndex = -1;
    this.draw();
  }

  // Fire onMovePoint for interior point at `idx` (curve point index).
  // Returns the clamp result (or undefined).
  _notifyMove(idx) {
    if (this._isEndpoint(idx)) return;
    if (!this.callbacks.onMovePoint) return;
    const cPts = this.channels.C.points;
    const hPts = this.channels.H.points;
    return this.callbacks.onMovePoint(idx - 1, cPts[idx].x, cPts[idx].y, hPts[idx].y);
  }

  _showPointEditor(channel, index, pt) {
    // Remove any existing editor
    if (this._pointInput) this._pointInput.remove();

    const ch = this.channels[channel];
    const norm = this._normalize(channel, pt.y);
    const { px, py } = this._toPixel(pt.x, Math.max(0, Math.min(1, norm)));

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'curve-point-input';
    input.value = channel === 'H' ? pt.y.toFixed(1) : pt.y.toFixed(3);
    input.style.insetInlineStart = px + 'px';
    input.style.insetBlockStart = py + 'px';

    const commit = () => {
      const val = parseFloat(input.value);
      if (!isNaN(val)) {
        pt.y = Math.max(ch.min, Math.min(ch.max, val));
        this._notifyMove(index);
        this._applyGamutSnapBack(index);
        if (this.callbacks.onDragEnd) this.callbacks.onDragEnd();
        this.draw();
      }
      input.remove();
      this._pointInput = null;
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); input.remove(); this._pointInput = null; }
    });
    input.addEventListener('blur', commit);

    this.container.appendChild(input);
    this._pointInput = input;
    input.select();
    input.focus();
  }

  destroy() {
    if (this._pointInput) this._pointInput.remove();
    this.canvas.remove();
  }
}
