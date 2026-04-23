import time
import asyncio
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
import numpy as np
from typing import List

app = FastAPI(title="S/R Analyzer")

# ── Cache ──────────────────────────────────────────────────────────────────────
_CACHE_TTL = {
    "1m": 60,   "2m": 120,  "5m": 300,   "15m": 900,
    "30m": 1800,"60m": 3600,"90m": 3600, "1h": 3600,
    "1d": 3600, "5d": 7200, "1wk": 7200, "1mo": 14400, "3mo": 14400,
}
_ohlcv_cache: dict = {}


def _cache_get(ticker: str, period: str, interval: str):
    entry = _ohlcv_cache.get((ticker, period, interval))
    if entry and time.time() - entry["ts"] < _CACHE_TTL.get(interval, 3600):
        return entry["data"]
    return None


def _cache_set(ticker: str, period: str, interval: str, data: list):
    _ohlcv_cache[(ticker, period, interval)] = {"ts": time.time(), "data": data}


# ── Yahoo Finance fetch with retry ─────────────────────────────────────────────
def _download_blocking(ticker: str, period: str, interval: str, max_retries: int = 3):
    """Synchronous yfinance download with exponential backoff on rate limit."""
    for attempt in range(max_retries):
        try:
            df = yf.download(ticker, period=period, interval=interval,
                             progress=False, auto_adjust=True)
            if df.empty or len(df) < 3:
                return None

            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)

            df = df.reset_index()
            time_col = "Datetime" if "Datetime" in df.columns else "Date"

            ohlcv = []
            for _, row in df.iterrows():
                ts = int(pd.Timestamp(row[time_col]).timestamp())
                ohlcv.append({
                    "time": ts,
                    "open":  round(float(row["Open"]),  4),
                    "high":  round(float(row["High"]),  4),
                    "low":   round(float(row["Low"]),   4),
                    "close": round(float(row["Close"]), 4),
                })
            return ohlcv

        except Exception as e:
            name = type(e).__name__
            if "RateLimit" in name or "TooMany" in name or "429" in str(e):
                if attempt < max_retries - 1:
                    wait = 2 ** attempt + 1   # 2 s, 3 s, 5 s
                    print(f"[{ticker}] Rate limited — retry {attempt+1}/{max_retries} in {wait}s")
                    time.sleep(wait)
                    continue
            print(f"[{ticker}] Error: {e}")
            return None
    return None


async def _fetch_ohlcv(ticker: str, period: str, interval: str):
    cached = _cache_get(ticker, period, interval)
    if cached is not None:
        return cached, True

    # Run blocking IO in thread pool so the event loop stays free
    data = await asyncio.to_thread(_download_blocking, ticker, period, interval)
    if data:
        _cache_set(ticker, period, interval, data)
    return data, False


# ── API ────────────────────────────────────────────────────────────────────────
class OhlcvRequest(BaseModel):
    tickers: List[str]
    period: str = "3mo"
    interval: str = "1d"


@app.post("/api/ohlcv")
async def fetch_ohlcv(req: OhlcvRequest):
    results = []
    for raw in req.tickers:
        ticker = raw.strip().upper()
        if not ticker:
            continue
        try:
            data, from_cache = await _fetch_ohlcv(ticker, req.period, req.interval)
            if data:
                results.append({"ticker": ticker, "ohlcv": data, "from_cache": from_cache})
        except Exception as e:
            print(f"[{ticker}] Unexpected: {e}")

    return {"results": results}


# ── Serve React build (must be last) ──────────────────────────────────────────
_STATIC = Path(__file__).parent / "static"
if _STATIC.exists():
    app.mount("/", StaticFiles(directory=_STATIC, html=True), name="static")
