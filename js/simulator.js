/* =========================================================
   PicoWSimulator — 純前端裝置模擬器
   重現 Pico W 的行為：週期取樣 DHT22、Wi-Fi 連線狀態、
   HTTP POST 封包、看門狗與斷線重連。
   目的：讓 Dashboard 在沒有實體硬體時也能完整示範。
   接上真機時，只需以真實 API 回應餵入相同的 reading 結構。
   ========================================================= */
(function (global) {
  "use strict";

  const SCENARIOS = {
    indoor:     { name: "室內環境", temp: 24, hum: 55, tempVar: 0.35, humVar: 0.9, drift: 0.4 },
    outdoor:    { name: "戶外環境", temp: 31, hum: 68, tempVar: 0.55, humVar: 1.4, drift: 1.0 },
    coldchain:  { name: "冷鏈運輸", temp: 5,  hum: 78, tempVar: 0.25, humVar: 0.8, drift: 0.3 },
    greenhouse: { name: "溫室栽培", temp: 29, hum: 82, tempVar: 0.4, humVar: 1.1, drift: 0.7 },
  };

  function PicoWSimulator() {
    this.listeners = {};
    this.scenario = "indoor";
    this.intervalMs = 2000;
    this.running = false;
    this.wifiOnline = true;
    this.failRate = 0.04;      // 每次上傳的失敗機率
    this.rssi = -58;
    this.uptime = 0;
    this.packets = 0;
    this.failures = 0;
    this.deviceId = "pico-w-01";
    this.firmware = "1.2.0";

    const s = SCENARIOS[this.scenario];
    this.t = s.temp;
    this.h = s.hum;
  }

  PicoWSimulator.prototype.on = function (evt, fn) {
    (this.listeners[evt] = this.listeners[evt] || []).push(fn);
    return this;
  };
  PicoWSimulator.prototype.emit = function (evt, payload) {
    (this.listeners[evt] || []).forEach((fn) => fn(payload));
  };

  PicoWSimulator.prototype.setScenario = function (key) {
    if (!SCENARIOS[key]) return;
    this.scenario = key;
    this.emit("event", { level: "info", msg: "感測情境切換 → " + SCENARIOS[key].name });
  };

  PicoWSimulator.prototype.setInterval = function (ms) {
    this.intervalMs = ms;
    this.emit("event", { level: "info", msg: "取樣間隔設為 " + (ms / 1000).toFixed(1) + "s" });
    if (this.running) { this.stop(); this.start(); }
  };

  PicoWSimulator.prototype.setOnline = function (online) {
    this.wifiOnline = online;
    if (online) {
      this.rssi = -58 + Math.random() * 6;
      this.emit("event", { level: "ok", msg: "Wi-Fi 已連線 · RSSI " + Math.round(this.rssi) + " dBm" });
      this.emit("status", { online: true });
    } else {
      this.emit("event", { level: "warn", msg: "Wi-Fi 中斷，進入離線緩衝模式" });
      this.emit("status", { online: false });
    }
  };

  // 體感溫度（Rothfusz），與韌體一致
  PicoWSimulator.prototype.heatIndex = function (tC, rh) {
    const t = tC * 9 / 5 + 32;
    let hi = -42.379 + 2.04901523 * t + 10.14333127 * rh
      - 0.22475541 * t * rh - 0.00683783 * t * t - 0.05481717 * rh * rh
      + 0.00122874 * t * t * rh + 0.00085282 * t * rh * rh
      - 0.00000199 * t * t * rh * rh;
    return Math.round(((hi - 32) * 5 / 9) * 10) / 10;
  };

  PicoWSimulator.prototype._step = function () {
    const s = SCENARIOS[this.scenario];

    // 均值回歸 + 隨機漫步，模擬真實感測漂移
    const targetT = s.temp + s.drift * Math.sin(this.uptime / 240);
    this.t += (targetT - this.t) * 0.06 + (Math.random() - 0.5) * s.tempVar;
    this.h += (s.hum - this.h) * 0.06 + (Math.random() - 0.5) * s.humVar;
    this.t = clamp(this.t, -5, 45);
    this.h = clamp(this.h, 5, 99);

    // Wi-Fi 訊號漫步，偶發瞬斷
    if (this.wifiOnline) {
      this.rssi += (Math.random() - 0.5) * 4;
      this.rssi = clamp(this.rssi, -88, -42);
      if (Math.random() < 0.012) this.setOnline(false);
    } else {
      if (Math.random() < 0.3) this.setOnline(true);
    }

    this.uptime += this.intervalMs / 1000;

    const reading = {
      device_id: this.deviceId,
      temperature: round1(this.t),
      humidity: round1(this.h),
      heat_index: this.heatIndex(this.t, this.h),
      rssi: Math.round(this.rssi),
      uptime_s: Math.round(this.uptime),
      ts: Date.now(),
    };

    // 離線或隨機失敗 → 不 POST，但仍取樣
    if (!this.wifiOnline) {
      this.emit("sample", reading);
      this.emit("event", { level: "warn", msg: "離線緩衝 · " + reading.temperature + "°C 暫存待補傳" });
      return;
    }
    if (Math.random() < this.failRate) {
      this.failures++;
      this.emit("sample", reading);
      this.emit("event", { level: "err", msg: "POST 逾時 (socket timeout)，將重試" });
      this.emit("stats", { packets: this.packets, failures: this.failures });
      return;
    }

    this.packets++;
    this.emit("sample", reading);
    this.emit("post", reading);
    this.emit("stats", { packets: this.packets, failures: this.failures });
  };

  PicoWSimulator.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.emit("event", { level: "ok", msg: "裝置啟動 · 韌體 v" + this.firmware + " · 裝置 ID " + this.deviceId });
    this._timer = setInterval(() => this._step(), this.intervalMs);
  };

  PicoWSimulator.prototype.stop = function () {
    this.running = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.emit("event", { level: "warn", msg: "裝置已停止（電源關閉）" });
  };

  PicoWSimulator.prototype.snapshot = function () {
    return {
      device_id: this.deviceId,
      firmware: this.firmware,
      scenario: this.scenario,
      interval: this.intervalMs,
      online: this.wifiOnline,
      rssi: Math.round(this.rssi),
      uptime: Math.round(this.uptime),
      packets: this.packets,
      failures: this.failures,
    };
  };

  PicoWSimulator.prototype.resetCounters = function () {
    this.packets = 0;
    this.failures = 0;
    this.emit("stats", { packets: 0, failures: 0 });
  };

  function round1(v) { return Math.round(v * 10) / 10; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  global.PicoWSimulator = PicoWSimulator;
  global.SCENARIOS = SCENARIOS;
})(window);
