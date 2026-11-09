"""
SparkSense Collector — 極簡資料收集端點（選用）
=================================================
接收 Pico W POST 的 JSON 讀值，寫入 SQLite，並提供查詢 API。
用於本機開發或小型部署；正式環境建議加上 TLS、鑑權與時序資料庫。

執行：
    pip install fastapi "uvicorn[standard]"
    uvicorn collector:app --host 0.0.0.0 --port 8000
"""

import json
import sqlite3
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

DEVICE_TOKEN = "replace-with-a-random-device-token"   # 與 Pico W 的 API_TOKEN 一致
DB_PATH = Path(__file__).with_name("readings.db")

app = FastAPI(title="SparkSense Collector")


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS readings (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               device_id TEXT, temperature REAL, humidity REAL,
               heat_index REAL, rssi INTEGER, uptime_s REAL, ts REAL)"""
    )
    return conn


class Reading(BaseModel):
    device_id: str
    temperature: float
    humidity: float
    heat_index: float | None = None
    rssi: int | None = None
    uptime_s: float | None = None
    ts: float | None = None


@app.post("/api/readings", status_code=201)
def ingest(reading: Reading, x_device_token: str = Header(default="")):
    if x_device_token != DEVICE_TOKEN:
        raise HTTPException(status_code=401, detail="invalid device token")
    ts = reading.ts or time.time()
    with db() as conn:
        conn.execute(
            "INSERT INTO readings VALUES (NULL,?,?,?,?,?,?,?)",
            (reading.device_id, reading.temperature, reading.humidity,
             reading.heat_index, reading.rssi, reading.uptime_s, ts),
        )
    return JSONResponse({"ok": True}, status_code=201)


@app.get("/api/readings")
def latest(limit: int = 100, device_id: str | None = None):
    q = "SELECT device_id,temperature,humidity,heat_index,rssi,ts FROM readings"
    args = []
    if device_id:
        q += " WHERE device_id = ?"
        args.append(device_id)
    q += " ORDER BY id DESC LIMIT ?"
    args.append(min(limit, 1000))
    with db() as conn:
        rows = [dict(zip(
            ("device_id", "temperature", "humidity", "heat_index", "rssi", "ts"), r))
            for r in conn.execute(q, args)]
    return {"count": len(rows), "readings": rows}
