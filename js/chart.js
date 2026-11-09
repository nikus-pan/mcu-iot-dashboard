/* =========================================================
   MiniChart — 零依賴 Canvas 折線圖
   用於 SparkSense Dashboard 的溫濕度趨勢圖。
   刻意不使用外部圖表庫：檔案小、無 CDN 相依、可離線運作。
   ========================================================= */
(function (global) {
  "use strict";

  const DEFAULTS = {
    color: "#22d3ee",
    fillTop: "rgba(34, 211, 238, 0.28)",
    fillBottom: "rgba(34, 211, 238, 0)",
    grid: "rgba(255,255,255,0.06)",
    axis: "#5b6b7e",
    label: "#8798ab",
    unit: "",
    padding: { top: 16, right: 14, bottom: 26, left: 42 },
  };

  function MiniChart(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opt = Object.assign({}, DEFAULTS, options || {});
    this.data = [];
    this.hoverIndex = -1;
    this._bindEvents();
    this.resize();
    // 跟隨容器尺寸變化（包含手機旋轉、側欄展開）
    if (global.ResizeObserver) {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas.parentElement || canvas);
    } else {
      global.addEventListener("resize", () => this.resize());
    }
    this.draw();
  }

  MiniChart.prototype._bindEvents = function () {
    const self = this;
    this.canvas.addEventListener("mousemove", function (e) {
      const rect = self.canvas.getBoundingClientRect();
      self._handlePointer(e.clientX - rect.left, rect.width);
    });
    this.canvas.addEventListener("mouseleave", function () {
      self.hoverIndex = -1;
      self.draw();
    });
    this.canvas.addEventListener("touchstart", function (e) {
      const rect = self.canvas.getBoundingClientRect();
      if (e.touches[0]) self._handlePointer(e.touches[0].clientX - rect.left, rect.width);
    }, { passive: true });
    this.canvas.addEventListener("touchmove", function (e) {
      const rect = self.canvas.getBoundingClientRect();
      if (e.touches[0]) self._handlePointer(e.touches[0].clientX - rect.left, rect.width);
    }, { passive: true });
  };

  MiniChart.prototype._handlePointer = function (x, width) {
    const n = this.data.length;
    if (n < 2) return;
    const pad = this.opt.padding;
    const plotW = width - pad.left - pad.right;
    const ratio = Math.min(Math.max((x - pad.left) / plotW, 0), 1);
    this.hoverIndex = Math.round(ratio * (n - 1));
    this.draw();
  };

  MiniChart.prototype.resize = function () {
    const dpr = global.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || this.canvas.clientWidth || 300;
    const h = rect.height || this.canvas.clientHeight || 200;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    this.draw();
  };

  MiniChart.prototype.setData = function (values, labels) {
    this.data = values || [];
    this.labels = labels || [];
    if (this.hoverIndex >= this.data.length) this.hoverIndex = -1;
    this.draw();
  };

  MiniChart.prototype._bounds = function () {
    const pad = this.opt.padding;
    const plotW = this.w - pad.left - pad.right;
    const plotH = this.h - pad.top - pad.bottom;
    let min = Infinity, max = -Infinity;
    for (const v of this.data) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!isFinite(min)) { min = 0; max = 1; }
    if (max - min < 1e-6) { min -= 1; max += 1; }
    const padY = (max - min) * 0.15;
    return { min: min - padY, max: max + padY, plotW, plotH };
  };

  MiniChart.prototype.draw = function () {
    const ctx = this.ctx;
    const { top, right, bottom, left } = this.opt.padding;
    const b = this._bounds();
    const xAt = (i) => left + (this.data.length <= 1 ? b.plotW / 2 : (i / (this.data.length - 1)) * b.plotW);
    const yAt = (v) => top + b.plotH - ((v - b.min) / (b.max - b.min)) * b.plotH;

    ctx.clearRect(0, 0, this.w, this.h);

    if (this.data.length < 2) {
      ctx.fillStyle = this.opt.axis;
      ctx.font = "12px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("等待資料…", this.w / 2, this.h / 2);
      ctx.textAlign = "left";
      return;
    }

    // ── 水平網格 + Y 軸刻度 ──
    const rows = 4;
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.textBaseline = "middle";
    for (let r = 0; r <= rows; r++) {
      const v = b.min + (b.max - b.min) * (r / rows);
      const y = yAt(v);
      ctx.strokeStyle = this.opt.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y + 0.5);
      ctx.lineTo(this.w - right, y + 0.5);
      ctx.stroke();
      ctx.fillStyle = this.opt.axis;
      ctx.textAlign = "right";
      ctx.fillText(v.toFixed(1), left - 8, y);
    }

    // ── X 軸時間標籤 ──
    if (this.labels && this.labels.length) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const ticks = Math.min(4, this.labels.length);
      for (let t = 0; t < ticks; t++) {
        const idx = Math.round((t / (ticks - 1)) * (this.labels.length - 1));
        ctx.fillStyle = this.opt.axis;
        ctx.fillText(this.labels[idx] || "", xAt(idx), top + b.plotH + 8);
      }
    }

    // ── 面積填充 ──
    const grad = ctx.createLinearGradient(0, top, 0, top + b.plotH);
    grad.addColorStop(0, this.opt.fillTop);
    grad.addColorStop(1, this.opt.fillBottom);
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(this.data[0]));
    for (let i = 1; i < this.data.length; i++) {
      const x0 = xAt(i - 1), x1 = xAt(i);
      const y0 = yAt(this.data[i - 1]), y1 = yAt(this.data[i]);
      const cx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
    }
    const fillPath = new Path2D();
    ctx.save();
    ctx.lineTo(xAt(this.data.length - 1), top + b.plotH);
    ctx.lineTo(xAt(0), top + b.plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // ── 折線 ──
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(this.data[0]));
    for (let i = 1; i < this.data.length; i++) {
      const x0 = xAt(i - 1), x1 = xAt(i);
      const y0 = yAt(this.data[i - 1]), y1 = yAt(this.data[i]);
      const cx = (x0 + x1) / 2;
      ctx.bezierCurveTo(cx, y0, cx, y1, x1, y1);
    }
    ctx.strokeStyle = this.opt.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.shadowColor = this.opt.color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ── 最新點 ──
    const lastX = xAt(this.data.length - 1);
    const lastY = yAt(this.data[this.data.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = this.opt.color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
    ctx.strokeStyle = this.opt.color;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // ── Hover 提示 ──
    if (this.hoverIndex >= 0 && this.hoverIndex < this.data.length) {
      const hx = xAt(this.hoverIndex);
      const hy = yAt(this.data[this.hoverIndex]);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.moveTo(hx, top);
      ctx.lineTo(hx, top + b.plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();

      const val = this.data[this.hoverIndex].toFixed(1) + this.opt.unit;
      const lbl = (this.labels && this.labels[this.hoverIndex]) || "";
      ctx.font = "11px 'JetBrains Mono', monospace";
      const text = lbl ? lbl + " · " + val : val;
      const tw = ctx.measureText(text).width + 16;
      let bx = hx - tw / 2;
      bx = Math.max(left, Math.min(bx, this.w - right - tw));
      const by = Math.max(2, hy - 30);
      ctx.fillStyle = "rgba(6, 9, 14, 0.94)";
      ctx.strokeStyle = "rgba(34,211,238,0.4)";
      ctx.lineWidth = 1;
      roundRect(ctx, bx, by, tw, 20, 5);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#e7eef6";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx + tw / 2, by + 10);
      ctx.textAlign = "left";
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  global.MiniChart = MiniChart;
})(window);
