// ChromaScale — Curve Editor v3
// Canvas-based C/H curve editor with L as non-interactive reference line

class CurveEditor {
  constructor(container, onChange) {
    this.container = container;
    this.onChange = onChange;
    this.canvas = document.createElement('canvas');
    this.ctx = null;
    this.dpr = window.devicePixelRatio || 1;

    this.padding = { top: 20, right: 24, bottom: 32, left: 44 };
    this.width = 0;
    this.height = 0;

    this.channels = {
      L: { color: '#555', label: 'Lightness', min: 0, max: 1, points: [], interactive: false },
      C: { color: '#D97757', label: 'Chroma', min: 0, max: 0.4, points: [], interactive: true },
      H: { color: '#6A9BCC', label: 'Hue', min: 0, max: 360, points: [], interactive: true }
    };

    // Constraint boundaries for L curve
    this.constraintBounds = []; // [{t, minL, maxL}]

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
    this.canvas.style.width = '100%';
    this.canvas.style.height = '220px';
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

    this._drawGrid(ctx);
    this._drawConstraintBands(ctx);
    this._drawGradientStrip(ctx);

    // Draw L first (behind interactive curves), then C and H
    this._drawCurve(ctx, 'L');
    for (const ch of ['H', 'C']) this._drawCurve(ctx, ch);
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

  _drawGradientStrip(ctx) {
    const p = this.padding;
    const w = this.width - p.left - p.right;
    const stripH = 6;
    const y = this.height - p.bottom + 18;

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
      ctx.fillRect(p.left + i * stepW, y, stepW + 1, stripH);
    }

    const theme = this._getThemeColors();
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.left, y, w, stripH);
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

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this._onMouseUp());
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
    const nearest = this._findNearestPoint(px, py, 14);

    if (nearest) {
      this.dragging = { channel: nearest.channel, index: nearest.index, fixX: false };
      this.canvas.style.cursor = 'grabbing';
    } else {
      const nearestCurve = this._findNearestCurve(px, py);
      if (nearestCurve) {
        const { x, yNorm } = this._fromPixel(px, py);
        const value = this._denormalize(nearestCurve, yNorm);
        const ch = this.channels[nearestCurve];
        ch.points.push({ x, y: value });
        ch.points.sort((a, b) => a.x - b.x);
        const newIdx = ch.points.findIndex(p => p.x === x && p.y === value);
        this.dragging = { channel: nearestCurve, index: newIdx, fixX: false };
        this.canvas.style.cursor = 'grabbing';
        this.draw();
        this._notify();
      }
    }
  }

  _onMouseMove(e) {
    const { px, py } = this._getMousePos(e);

    if (this.dragging) {
      const { x, yNorm } = this._fromPixel(px, py);
      const ch = this.channels[this.dragging.channel];
      const pt = ch.points[this.dragging.index];

      if (!this.dragging.fixX) {
        const prevX = this.dragging.index > 0 ? ch.points[this.dragging.index - 1].x + 0.005 : 0;
        const nextX = this.dragging.index < ch.points.length - 1 ? ch.points[this.dragging.index + 1].x - 0.005 : 1;
        pt.x = Math.round(Math.max(prevX, Math.min(nextX, x)) * 100) / 100;
      }

      pt.y = this._denormalize(this.dragging.channel, yNorm);
      pt.y = Math.round(Math.max(ch.min, Math.min(ch.max, pt.y)) * 100) / 100;

      this.draw();
      this._notify();
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

  _onMouseUp() {
    this.dragging = null;
    this.canvas.style.cursor = 'crosshair';
  }

  _onMouseLeave() {
    this.dragging = null;
    this.hoveredChannel = null;
    this.hoveredIndex = -1;
    this.canvas.style.cursor = 'crosshair';
    this.draw();
  }

  _onDoubleClick(e) { this._onRightClick(e); }

  _onRightClick(e) {
    const { px, py } = this._getMousePos(e);
    const nearest = this._findNearestPoint(px, py, 14);
    if (!nearest) return;

    const ch = this.channels[nearest.channel];
    if (nearest.index === 0 || nearest.index === ch.points.length - 1) return;
    if (ch.points.length <= 2) return;

    ch.points.splice(nearest.index, 1);
    this.hoveredChannel = null;
    this.hoveredIndex = -1;
    this.draw();
    this._notify();
  }

  _notify() {
    if (this.onChange) {
      // Only report interactive channels (C and H) — L is fixed
      this.onChange({
        C: this.getPoints('C'),
        H: this.getPoints('H')
      });
    }
  }

  destroy() {
    this.canvas.remove();
  }
}
