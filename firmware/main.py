"""
SparkSense Node — Pico W 物聯網感測節點
=========================================
Raspberry Pi Pico W + DHT22 溫濕度感測器
讀取感測值 → 透過 Wi-Fi POST 到 HTTP 端點 → 網頁 Dashboard 即時顯示

硬體接線：
    DHT22 VCC  -> Pico W 3V3(OUT)  (Pin 36)
    DHT22 DATA -> GP15             (Pin 20)  + 4.7k~10k 上拉電阻到 3V3
    DHT22 GND  -> Pico W GND       (Pin 38)

使用方式：
    1. 將 secrets.py 與 main.py 上傳到 Pico W（Thumbdrive 或 mpremote）
    2. 確認 dht.py 已存在（MicroPython 內建 dht 模組，無需額外檔案）
    3. 重置 Pico W，開啟序列埠 (115200) 觀看輸出
"""

import time
import json
import gc
import network
import socket
import machine
import dht
from machine import Pin, WDT

try:
    from secrets import WIFI_SSID, WIFI_PASSWORD, API_URL, API_TOKEN, DEVICE_ID
except ImportError:
    raise SystemExit("找不到 secrets.py，請先複製 secrets.example.py 並填入設定")

# ── 設定 ────────────────────────────────────────────────────────────
SENSOR_PIN = 15           # DHT22 DATA 腳位
SAMPLE_INTERVAL = 30      # 取樣間隔（秒）
WIFI_TIMEOUT = 20         # Wi-Fi 連線逾時（秒）
LED_PIN = "LED"           # Pico W 內建 LED

led = Pin(LED_PIN, Pin.OUT)
sensor = dht.DHT22(Pin(SENSOR_PIN))
wdt = WDT(timeout=8000)   # 看門狗，8 秒內需餵狗


# ── Wi-Fi ───────────────────────────────────────────────────────────
def connect_wifi():
    """連線到 Wi-Fi，成功回傳 wlan 物件，失敗回傳 None。"""
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if wlan.isconnected():
        return wlan

    print("[wifi] 連線至", WIFI_SSID, "...")
    wlan.connect(WIFI_SSID, WIFI_PASSWORD)

    start = time.time()
    while not wlan.isconnected():
        if time.time() - start > WIFI_TIMEOUT:
            print("[wifi] 連線逾時")
            return None
        led.toggle()
        time.sleep(0.25)

    led.value(1)
    ip = wlan.ifconfig()[0]
    print("[wifi] 已連線，IP =", ip)
    return wlan


# ── 讀取感測器 ───────────────────────────────────────────────────────
def read_sensor():
    """讀取 DHT22，回傳 (temperature_c, humidity_pct)。失敗回傳 (None, None)。"""
    try:
        sensor.measure()
        return sensor.temperature(), sensor.humidity()
    except OSError as e:
        print("[sensor] 讀取失敗:", e)
        return None, None


def heat_index(t_c, rh):
    """以 Rothfusz 公式計算體感溫度（攝氏）。"""
    if t_c is None or rh is None:
        return None
    t = t_c * 9 / 5 + 32          # 轉華氏計算
    hi = (
        -42.379 + 2.04901523 * t + 10.14333127 * rh
        - 0.22475541 * t * rh - 0.00683783 * t * t
        - 0.05481717 * rh * rh + 0.00122874 * t * t * rh
        + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh
    )
    return round((hi - 32) * 5 / 9, 1)


# ── HTTP POST ───────────────────────────────────────────────────────
def post_reading(t_c, rh, rssi):
    """將讀值以 JSON POST 到 API_URL，回傳 HTTP 狀態碼或 None。"""
    payload = json.dumps({
        "device_id": DEVICE_ID,
        "temperature": t_c,
        "humidity": rh,
        "heat_index": heat_index(t_c, rh),
        "rssi": rssi,
        "uptime_s": time.time(),
        "ts": time.time(),
    })
    body = payload.encode()

    # 解析 API_URL，例如 http://192.168.1.100:8000/api/readings
    host, _, path = API_URL.replace("http://", "").partition("/")
    path = "/" + path
    addr = socket.getaddrinfo(host.split(":")[0], int(host.split(":")[1] or 80))[0][-1]

    s = socket.socket()
    s.settimeout(10)
    try:
        s.connect(addr)
        headers = (
            "POST %s HTTP/1.1\r\n"
            "Host: %s\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: %d\r\n"
            "X-Device-Token: %s\r\n"
            "Connection: close\r\n\r\n"
        ) % (path, host, len(body), API_TOKEN)
        s.write(headers.encode())
        s.write(body)
        status_line = s.readline().decode().strip()
        print("[http] <-", status_line, payload)
        # 取狀態碼，例如 "HTTP/1.1 201 Created" -> 201
        parts = status_line.split()
        return int(parts[1]) if len(parts) > 1 else None
    except Exception as e:
        print("[http] 傳送失敗:", e)
        return None
    finally:
        s.close()


# ── 主迴圈 ─────────────────────────────────────────────────────────
def main():
    wlan = connect_wifi()
    print("[boot] SparkSense Node 啟動，裝置 ID =", DEVICE_ID)

    wifi_down_since = None
    while True:
        wdt.feed()

        # 維持 Wi-Fi（斷線自動重連）
        if not wlan or not wlan.isconnected():
            if wifi_down_since is None:
                wifi_down_since = time.time()
                led.value(0)
            wlan = connect_wifi()
            if not wlan:
                time.sleep(5)
                continue
            print("[wifi] 重新連線，離線 %.0f 秒" % (time.time() - wifi_down_since))
            wifi_down_since = None

        t_c, rh = read_sensor()
        if t_c is not None:
            rssi = wlan.status("rssi")
            code = post_reading(t_c, rh, rssi)
            # 成功 LED 快閃一下
            if code and 200 <= code < 300:
                led.value(1)
                time.sleep(0.05)
                led.value(0)
        else:
            print("[sensor] 略過本次（讀取失敗）")

        gc.collect()   # 釋放記憶體，長時間運作更穩定
        time.sleep(SAMPLE_INTERVAL)


if __name__ == "__main__":
    main()
