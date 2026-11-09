/* =========================================================
   SparkSense Dashboard — 前端資料流與 UI 綁定
   ========================================================= */
(function () {
  "use strict";

  const MAX_POINTS = 150;      // 圖表保留的取樣點數
  const MAX_EVENTS = 40;

  const el = (id) => document.getElementById(id);
  const fmt1 = (v) => (v == null || isNaN(v) ? "--.-" : v.toFixed(1));
  const pad = (n) => String(n).padStart(2, "0");

  function clockTime(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function hhmmss(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return pad(h) + ":" + pad(m) + ":" + pad(s);
  }
  function signalLevel(rssi) {
    if (rssi >= -55) return 4;
    if (rssi >= -65) return 3;
    if (rssi >= -75) return 2;
    if (rssi >= -85) return 1;
    return 0;
  }

  // ── 狀態 ──
  const history = { t: [], h: [], labels: [], ts: [] };

  // ── 圖表初始化 ──
  const tempChart = new MiniChart(el("tempChart"), {
    color: "#f59e0b", unit: "°C",
    fillTop: "rgba(245,158,11,0.26)", fillBottom: "rgba(245,158,11,0)",
  });
  const humChart = new MiniChart(el("humChart"), {
    color: "#22d3ee", unit: "%",
    fillTop: "rgba(34,211,238,0.26)", fillBottom: "rgba(34,211,238,0)",
  });

  const sim = new PicoWSimulator();

  // ── 事件流 ──
  function addEvent(level, msg) {
    const list = el("eventLog");
    const li = document.createElement("li");
    li.innerHTML = '<time>' + clockTime(Date.now()) + "</time>" +
      '<span class="ev-' + level + '">' + escapeHtml(msg) + "</span>";
    list.insertBefore(li, list.firstChild);
    while (list.children.length > MAX_EVENTS) list.removeChild(list.lastChild);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ── Payload 檢視（自製語法上色）──
  function renderPayload(reading) {
    const entries = [
      ["device_id", '"' + reading.device_id + '"', "s"],
      ["temperature", reading.temperature, "n"],
      ["humidity", reading.humidity, "n"],
      ["heat_index", reading.heat_index, "n"],
      ["rssi", reading.rssi, "n"],
      ["uptime_s", reading.uptime_s, "n"],
      ["ts", reading.ts, "n"],
    ];
    const lines = entries.map(([k, v, t], i) => {
      const comma = i < entries.length - 1 ? "," : "";
      return '  <span class="k">"' + k + '"</span>: <span class="' + t + '">' + v + "</span>" + comma;
    });
    el("payloadView").innerHTML = "{\n" + lines.join("\n") + "\n}";
  }

  // ── 讀值處理 ──
  function onSample(r) {
    history.t.push(r.temperature);
    history.h.push(r.humidity);
    history.labels.push(clockTime(r.ts));
    history.ts.push(r.ts);
    while (history.t.length > MAX_POINTS) {
      history.t.shift(); history.h.shift(); history.labels.shift(); history.ts.shift();
    }

    // KPI
    el("kpiTemp").textContent = fmt1(r.temperature);
    el("kpiHum").textContent = fmt1(r.humidity);
    el("kpiHI").textContent = fmt1(r.heat_index);
    el("kpiTempFoot").textContent = "RSSI " + r.rssi + " dBm · " + (r.temperature > 28 ? "偏熱" : r.temperature < 10 ? "低溫" : "舒適");
    el("kpiHumFoot").textContent = r.humidity > 75 ? "濕度高，注意結露" : r.humidity < 35 ? "偏乾，建議補水" : "濕度適中";

    // Hero 讀值
    el("heroTemp").textContent = fmt1(r.temperature);
    el("heroHum").textContent = fmt1(r.humidity);
    el("statRssi").textContent = r.rssi + " dBm";
    el("statUptime").textContent = hhmmss(r.uptime_s);
    el("heroUptime").textContent = hhmmss(r.uptime_s);
    el("heroRssi").textContent = r.rssi;
    el("statSignal").setAttribute("data-level", signalLevel(r.rssi));

    // 圖表
    tempChart.setData(history.t.slice(), history.labels.slice());
    humChart.setData(history.h.slice(), history.labels.slice());

    updateDelta();
    updateHeroBars(r.temperature, r.humidity);
    renderPayload(r);
  }

  function onPost(r) {
    addEvent("ok", "POST 201 · " + r.temperature + "°C / " + r.humidity + "% → /api/readings");
    const st = el("payloadStatus");
    st.textContent = "201 Created";
    st.className = "ok";
  }

  function updateDelta() {
    // 與約 60 秒前比較
    const now = Date.now();
    const idx = history.ts.findIndex((t) => now - t <= 60000);
    if (idx < 0 || history.t.length < 2) {
      el("tempDelta").textContent = "—"; el("humDelta").textContent = "—";
      return;
    }
    setDelta(el("tempDelta"), history.t[history.t.length - 1] - history.t[0], "°C");
    setDelta(el("humDelta"), history.h[history.h.length - 1] - history.h[0], "%");
  }
  function setDelta(node, diff, unit) {
    const sign = diff > 0 ? "+" : "";
    node.textContent = sign + diff.toFixed(1) + unit;
    node.className = diff > 0.05 ? "pos" : diff < -0.05 ? "neg" : "";
  }

  function updateHeroBars(temp, hum) {
    const bars = el("heroBars");
    if (!bars.children.length) {
      for (let i = 0; i < 22; i++) bars.appendChild(document.createElement("i"));
    }
    const arr = bars.children;
    const base = temp / 40;
    for (let i = 0; i < arr.length; i++) {
      const wave = 0.6 + 0.4 * Math.sin((Date.now() / 800) + i * 0.5);
      const h = Math.max(6, Math.min(100, (base * 100) * wave));
      arr[i].style.height = h.toFixed(0) + "%";
    }
  }

  function updateStats(s) {
    el("statPackets").textContent = s.packets + " / " + s.failures;
    el("heroLed").className = "chip-led" + (sim.wifiOnline ? "" : " off");
  }

  function setConnection(online) {
    el("navDot").className = "dot" + (online ? "" : " off");
    el("navStatusText").textContent = online ? "裝置連線中" : "裝置離線";
    el("kpiDevTag").textContent = online ? "ONLINE" : "OFFLINE";
    el("kpiDevTag").style.color = online ? "var(--green)" : "var(--red)";
    el("payloadStatus").textContent = online ? "201 Created" : "— buffered";
    el("payloadStatus").className = online ? "ok" : "bad";
    el("heroLed").className = "chip-led" + (online ? "" : " off");
    el("heroBars").style.opacity = online ? "1" : ".35";
  }

  // ── 模擬器事件訂閱 ──
  sim.on("sample", onSample);
  sim.on("post", onPost);
  sim.on("event", (e) => addEvent(e.level, e.msg));
  sim.on("stats", updateStats);
  sim.on("status", (s) => setConnection(s.online));

  // ── 控制項 ──
  el("scenario").addEventListener("change", (e) => sim.setScenario(e.target.value));
  el("interval").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    el("intervalVal").textContent = v.toFixed(1) + "s";
    sim.setInterval(v * 1000);
  });

  el("btnPower").addEventListener("click", () => {
    const btn = el("btnPower");
    const on = btn.dataset.state === "on";
    if (on) {
      sim.stop();
      btn.dataset.state = "off";
      el("powerText").textContent = "裝置已停止";
      el("powerDot").className = "dot off";
    } else {
      sim.start();
      btn.dataset.state = "on";
      el("powerText").textContent = "裝置運作中";
      el("powerDot").className = "dot";
    }
  });

  el("btnClear").addEventListener("click", () => {
    history.t = []; history.h = []; history.labels = []; history.ts = [];
    tempChart.setData([]); humChart.setData([]);
    sim.resetCounters();
    el("eventLog").innerHTML = "";
    addEvent("info", "已清除歷史資料");
  });

  // ── 韌體程式碼頁籤 ──
  document.querySelectorAll(".code-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".code-tab").forEach((t) => {
        t.classList.remove("active"); t.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".code-body").forEach((b) => b.classList.remove("active"));
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      const target = document.getElementById(tab.dataset.target);
      if (target) target.classList.add("active");
    });
  });

  // ── 導覽列 ──
  const header = el("siteHeader");
  window.addEventListener("scroll", () => {
    header.classList.toggle("scrolled", window.scrollY > 12);
  }, { passive: true });

  const navToggle = el("navToggle");
  const mainNav = el("mainNav");
  navToggle.addEventListener("click", () => {
    const open = mainNav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(open));
  });
  mainNav.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      mainNav.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    })
  );

  const navLinks = Array.from(document.querySelectorAll(".main-nav a"));
  const sections = navLinks
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((a) =>
          a.classList.toggle("active", a.getAttribute("href") === "#" + entry.target.id)
        );
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach((s) => io.observe(s));
  }

  // ── 啟動 ──
  addEvent("info", "Dashboard 已就緒，等待裝置連線…");
  sim.start();
  setConnection(true);
})();
