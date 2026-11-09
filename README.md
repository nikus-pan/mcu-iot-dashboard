# SparkSense Node — Pico W 物聯網感測節點

以 **Raspberry Pi Pico W** 為核心的溫濕度監測系統：DHT22 讀取環境數據，經 Wi-Fi 以 JSON POST 上傳，並在響應式網頁 Dashboard 即時視覺化。本專案為硬體與軟體整合作品，從 MicroPython 韌體、GPIO 接線到前端資料呈現，涵蓋完整資料鏈路。

> 展示頁面內建 **純 JavaScript 裝置模擬器**，無需實體硬體即可完整示範 Dashboard 行為；接上真機後僅需把讀值來源換成真實 API。

---

## 功能特色

| 模組 | 說明 |
|---|---|
| 即時 Dashboard | 溫濕度 KPI、體感溫度、趨勢折線圖、裝置健康狀態 |
| 裝置模擬器 | 重現取樣、均值回歸漂移、Wi-Fi 瞬斷、POST 逾時與重連 |
| MicroPython 韌體 | DHT22 讀值、Rothfusz 體感溫度、原生 socket HTTP POST、看門狗 |
| 收集端端點 | FastAPI 接收 JSON、驗證裝置 Token、寫入 SQLite 並提供查詢 API |
| 響應式設計 | 深色科技工業風，支援桌機 / 平板 / 手機，含動畫與無障礙標註 |

**技術要點**：零前端框架、零外部圖表庫——趨勢圖為自製 Canvas 渲染器（`js/chart.js`），檔案小、可離線運作。

---

## 硬體清單（BOM）

| # | 零件 | 規格 | 數量 |
|---|---|---|---|
| 1 | Raspberry Pi Pico W | RP2040 雙核 + CYW43439 Wi-Fi | 1 |
| 2 | DHT22 / AM2302 | 溫濕度感測器，3.3–5V，單線 | 1 |
| 3 | 上拉電阻 | 4.7kΩ–10kΩ，1/4W | 1 |
| 4 | 麵包板 + 杜邦線 | 400 孔，母對公 | 1 |
| 5 | Micro-USB 電源 | 5V / 1A（或鋰電 + 穩壓） | 1 |

成本約 **NT$350–500**，可用行動電源供電，適合部署於任何角落。

---

## 接線圖

```
        DHT22                       Raspberry Pi Pico W
    ┌───────────┐                ┌──────────────────────┐
    │  VCC  ────┼────────────────┤  3V3(OUT)   Pin 36   │
    │           │        ┌───────┤  3V3(OUT)   Pin 36   │
    │           │        │       │                      │
    │           │        │  ┌────┤  GP15       Pin 20   │
    │  DATA ────┼────────┴──┤    │                      │
    │           │   4.7kΩ  │    │                      │
    │           │   上拉   │    │                      │
    │           │           │    │                      │
    │  GND  ────┼────────────────┤  GND        Pin 38   │
    └───────────┘                └──────────────────────┘
```

- **VCC** → `3V3(OUT)`
- **DATA** → `GP15`，並以 4.7kΩ 電阻上拉到 `3V3(OUT)`（DHT22 單線協定為開汲極，必須上拉）
- **GND** → `GND`

> 展示頁 `#hardware` 區塊提供對應的互動式接線示意圖（SVG）。

---

## 目錄結構

```
mcu-iot-dashboard/
├── index.html              # 展示頁（Hero / Dashboard / 硬體 / 架構 / 韌體）
├── css/style.css           # 深色科技工業風樣式（含 RWD 斷點）
├── js/
│   ├── chart.js            # 自製 Canvas 折線圖（零依賴）
│   ├── simulator.js        # Pico W 裝置模擬器
│   └── app.js              # Dashboard 資料流與 UI 綁定
├── firmware/
│   ├── main.py             # Pico W MicroPython 主程式
│   └── secrets.example.py  # 設定範本（Wi-Fi / API 端點）
├── server/
│   └── collector.py        # FastAPI 收集端點（選用）
└── README.md
```

---

## 系統架構

```
┌─────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌────────────┐
│ A 感測層 │   │ B 邊緣運算    │   │ C 傳輸層      │   │ D 收集層      │   │ E 呈現層    │
│ DHT22   │──▶│ Pico W       │──▶│ HTTP POST    │──▶│ FastAPI      │──▶│ Dashboard  │
│ GPIO    │   │ MicroPython  │   │ JSON + Token │   │ SQLite       │   │ HTML/Canvas│
└─────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └────────────┘
```

---

## 快速開始（純展示，無需硬體）

```bash
cd mcu-iot-dashboard
# 任一靜態伺服器皆可
python3 -m http.server 5500
# 開啟 http://localhost:5500
```

頁面載入後模擬器會自動啟動，約 2 秒產生一筆讀值。

---

## 部署到實體裝置

### 1. 刷入 MicroPython 韌體
1. 下載 Pico W 專用 MicroPython UF2：<https://micropython.org/download/RPI_PICO_W/>
2. 按住 Pico W 上的 **BOOTSEL** 鍵，插上 USB，放開後會出現 `RPI-RP2` 隨身碟。
3. 將 `.uf2` 檔案拖入隨身碟，裝置會自動重開。

### 2. 上傳程式
使用 Thonny 或 `mpremote`：

```bash
# 複製範本並填入你的設定
cp firmware/secrets.example.py firmware/secrets.py
$EDITOR firmware/secrets.py

# 上傳到 Pico W
mpremote connect auto fs cp firmware/main.py :main.py
mpremote connect auto fs cp firmware/secrets.py :secrets.py
mpremote connect auto reset
```

### 3. 啟動收集端點

```bash
pip install fastapi "uvicorn[standard]"
uvicorn server.collector:app --host 0.0.0.0 --port 8000
```

將 `firmware/secrets.py` 的 `API_URL` 指向該電腦的內網 IP，例如 `http://192.168.1.100:8000/api/readings`。

### 4. 開 Dashboard
瀏覽器開啟 `index.html` 即可監看。要接真實資料時，在 `js/app.js` 中改為向 `/api/readings` 輪詢，餵入與 `simulator.js` 相同結構的 `reading` 物件。

---

## MicroPython 韌體核心

完整原始碼見 [`firmware/main.py`](firmware/main.py)。核心行為：

- **Wi-Fi 連線與自動重連**：逾時保護，斷線後持續重試並記錄離線時間。
- **感測讀取**：`dht.DHT22` 於 GP15，例外處理避免單次失敗中斷迴圈。
- **體感溫度**：以 Rothfusz 公式在裝置端計算，減少後端負載。
- **HTTP 上傳**：以原生 `socket` 發送 HTTP/1.1 POST（MicroPython 標準庫無 `requests`）。
- **看門狗 (WDT)**：8 秒餵狗，程式卡死時自動重置，適合長時間無人值守。

關鍵片段：

```python
sensor = dht.DHT22(Pin(15))

def read_sensor():
    try:
        sensor.measure()
        return sensor.temperature(), sensor.humidity()
    except OSError as e:
        return None, None

payload = json.dumps({
    "device_id": DEVICE_ID,
    "temperature": t_c, "humidity": rh,
    "heat_index": heat_index(t_c, rh),
    "rssi": rssi, "ts": time.time(),
})
```

---

## 可靠性與維運考量

- **看門狗 + `gc.collect()`**：避免長時間運作後記憶體碎裂或程式卡死。
- **離線緩衝**：真實部署可將失敗讀值暫存於裝置或後端佇列，網路恢復後補傳。
- **裝置鑑權**：`X-Device-Token` 標頭驗證，避免任意來源寫入。
- **生產強化建議**：改用 HTTPS、加入速率限制、時序資料庫（InfluxDB / TimescaleDB）與告警規則。

---

## 授權

作品展示用途。範例程式碼可自由參考修改。

© 2026 靈機工作室 Spark Studio
