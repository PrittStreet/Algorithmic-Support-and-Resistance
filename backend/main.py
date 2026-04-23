import time
import asyncio
import json
import sqlite3
import uuid
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import yfinance as yf
import pandas as pd
import numpy as np
from typing import List, Optional, Any

app = FastAPI(title="S/R Analyzer")

# ── SQLite ─────────────────────────────────────────────────────────────────────
DB_PATH = Path(__file__).parent / "sr_data.db"

_LIST_A = "CCEP,PAA,PLTR,AAL,AAPL,ABNB,ACGL,ADBE,ADI,ADP,ADSK,AEP,AGNC,AKAM,ALGN,ALNY,AMAT,AMD,AMGN,AMZN,APA,APPS,ARCC,ASML,AVGO,AVT,AXON,BIDU,BIIB,BILI,BKNG,BKR,BLDP,BLNK,BMRN,BNTX,BRKR,BYND,CAKE,CBRL,CDNS,CDW,CGC,CGNX,CHKP,CHRW,CHTR,CINF,CLSK,CMCSA,CME,COIN,COST,CPRT,CRSP,CRTO,CRWD,CSCO,CTAS,CTSH,CZR,DBX,DDOG,DKNG,DLTR,DOCU,DOX,DPZ,DXCM,EA,EBAY,EEFT,ENPH,EQIX,EXEL,EXPE,FANG,FAST,FCEL,FITB,FIVE,FLEX,FOX,FOXA,FSLR,FTNT,GDS,GILD,GLPI,GNTX,GOOG,GOOGL,GPRO,GT,HAS,HBAN,HOLX,HON,HOOD,HSIC,HST,HTHT,IAC,IDXX,ILMN,INCY,INO,INTC,INTU,IOVA,IPGP,IQ,ISRG,JAZZ,JBHT,JBLU,JD,JKHY,KHC,KLAC,LBTYA,LBTYK,LCID,LECO,LI,LKQ,LNT,LOGI,LRCX,LULU,LYFT,MAR,MASI,MAT,MCHP,MDB,MDLZ,MELI,META,MKTX,MLCO,MNST,MOMO,MPWR,MRNA,MRVL,MSFT,MSTR,MTCH,MU,NAVI,NBIX,NDAQ,NDSN,NFLX,NKTR,NMRK,NTAP,NTES,NTLA,NTRS,NVAX,NVDA,NWL,NWS,NWSA,NXPI,ODFL,OKTA,OLED,ON,ONC,OPK,ORLY,OTEX,PAYX,PCAR,PDBC,PDD,PENN,PEP,PFG,PLAY,PLUG,POOL,PSEC,PARA,PTC,PTON,PYPL,QCOM,QRVO,REG,REGN,RGLD,RIOT,RIVN,RKLB,ROKU,ROST,RYAAY,SABR,SBAC,SBUX,SEDG,SIRI,SLM,SNPS,SOHU,SONO,SPWR,SQQQ,SRPT,SSNC,STLD,STNE,STX,SVC,SWKS,TCOM,TEAM,TER,TLRY,TMUS,TRIP,TRMB,TROW,TSCO,TSLA,TTD,TTEK,TTWO,TXN,TXRH,UAL,ULTA,VEON,VOD,VRSK,VRSN,VRTX,VTRS,WB,WDC,WEN,WKHS,WVE,WYNN,XRAY,XRX,Z,ZBRA,ZION,ZM,ZS"
_LIST_B = "AIR,ATI,DBI,A,AA,AAP,ABBV,ABEV,ABT,ACM,ACN,ADM,AEE,AEM,AEO,AES,AFG,AFL,AGCO,AGO,AIG,AIZ,AJG,ALB,ALK,ALL,ALLE,ALLY,ALSN,AME,AMG,AMP,AMX,AN,ANET,ANF,AON,AOS,APD,APH,APTV,AR,ARW,ATHM,ATO,AWK,AXP,AYI,AZO,BA,BABA,BAC,BAH,BALL,BAP,BAX,BB,BBY,BC,BCE,BDX,BEN,BG,BHC,BIO,BK,BLK,BMO,BMY,BNS,BR,BRO,BSAC,BSX,BUD,BURL,BWA,BX,C,CAG,CAH,CARR,CAT,CB,CBRE,CCJ,CCK,CCL,CCU,CE,CF,CFG,CHD,CHGG,CHWY,CI,CIB,CIEN,CL,CLF,CLX,CMG,CMI,CMS,CNC,CNP,CNQ,COF,COP,COTY,CP,CPA,CPRI,CR,CRL,CRM,CTRA,CVE,CVI,CVS,CVX,CX,D,DAL,DD,DE,DECK,DELL,DG,DGX,DHI,DHR,DIS,DLB,DOV,DTE,DUK,DVA,DVN,DXC,EC,ECL,ED,EFX,EIX,EL,EMN,EMR,ENB,EOG,EPD,EQT,ES,ESNT,ETN,ETR,EW,F,FAF,FCX,FDS,FDX,FE,FHN,FIS,FLO,FLR,FLS,FMC,FMX,FNB,FNV,FTI,FTV,FVRR,GD,GE,GGB,GGG,GHC,GIL,GIS,GL,GLOB,GLW,GM,GNRC,GPC,GPK,GPN,GS,GSK,GWW,H,HAL,HCA,HD,HDB,HEI,HIG,HII,HLT,HMC,HOG,HP,HPE,HPQ,HRB,HRL,HSBC,HSY,HUM,HUN,HWM,HXL,IBM,IBN,ICE,IFF,INFY,INGR,IP,IQV,IR,IT,ITT,ITUB,ITW,IVZ,J,JBL,JCI,JEF,JMIA,JNJ,KEY,KEYS,KGC,KKR,KMI,KMX,KO,KOF,KR,KSS,L,LAC,LAZ,LDOS,LEA,LEG,LEN,LH,LHX,LII,LLY,LMT,LNC,LOW,LUMN,LUV,LVS,LYB,LYV,M,MA,MAN,MANU,MAS,MCD,MCK,MCO,MDT,MDU,MET,MFC,MGA,MGM,MHK,MKC,MKL,MLM,MMM,MO,MOH,MOS,MPC,MPLX,MRK,MS,MSCI,MSI,MSM,MTD,MTG,MUR,NEE,NEM,NEU,NI,NIO,NKE,NOC,NOK,NOW,NRG,NSC,NUE,NUS,NVS,OC,OGE,OKE,OMC,ORCL,OSK,OXY,PAGS,PAYC,PBR,PCG,PFE,PG,PH,PHM,PINS,PKG,PM,PNR,PNW,PPL,PRGO,PRU,PSX,QSR,RACE,RBLX,RCL,RF,RHI,RL,RNG,RNR,ROK,RRC,RS,RSG,SAP,SCHW,SE,SIG,SMG,SNAP,SNOW,SO,SONY,SPCE,SPGI,SPOT,SQM,STLA,STT,STZ,SU,SYY,T,TAL,TD,TGT,TM,TOL,TPR,TSM,TTC,TWLO,TXT,GRMN,VIRT"

def _uid() -> str:
    return uuid.uuid4().hex[:16]

def _db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn

def _db_init():
    with _db_connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS ticker_lists (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                tickers     TEXT NOT NULL,
                created_at  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS presets (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                params      TEXT NOT NULL,
                created_at  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                period      TEXT NOT NULL,
                interval_val TEXT NOT NULL,
                params      TEXT NOT NULL,
                tickers     TEXT NOT NULL,
                snapshot    TEXT NOT NULL,
                created_at  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS feedback (
                id          TEXT PRIMARY KEY,
                ticker      TEXT NOT NULL UNIQUE,
                vote        TEXT NOT NULL,
                tags        TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                created_at  INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ohlcv_cache (
                ticker       TEXT NOT NULL,
                period       TEXT NOT NULL,
                interval_val TEXT NOT NULL,
                data         TEXT NOT NULL,
                cached_at    INTEGER NOT NULL,
                PRIMARY KEY (ticker, period, interval_val)
            );
        """)
        count = conn.execute("SELECT COUNT(*) FROM ticker_lists").fetchone()[0]
        if count == 0:
            conn.execute("INSERT INTO ticker_lists VALUES (?,?,?,?)",
                         ("default-a", "Liste NASDAQ Tech", json.dumps(_LIST_A.split(",")), 0))
            conn.execute("INSERT INTO ticker_lists VALUES (?,?,?,?)",
                         ("default-b", "Liste NYSE/Large Cap", json.dumps(_LIST_B.split(",")), 0))
            conn.commit()

async def _db_fetchall(query: str, params=()) -> list[dict]:
    def _run():
        with _db_connect() as conn:
            return [dict(r) for r in conn.execute(query, params).fetchall()]
    return await asyncio.to_thread(_run)

async def _db_fetchone(query: str, params=()) -> dict | None:
    def _run():
        with _db_connect() as conn:
            r = conn.execute(query, params).fetchone()
            return dict(r) if r else None
    return await asyncio.to_thread(_run)

async def _db_execute(query: str, params=()):
    def _run():
        with _db_connect() as conn:
            conn.execute(query, params)
            conn.commit()
    await asyncio.to_thread(_run)

# Init on startup (synchronous — runs before any request)
_db_init()


# ── OHLCV in-memory cache + SQLite persistence ────────────────────────────────
_CACHE_TTL = {
    "1m": 60,   "2m": 120,  "5m": 300,   "15m": 900,
    "30m": 1800,"60m": 3600,"90m": 3600, "1h": 3600,
    "1d": 3600, "5d": 7200, "1wk": 7200, "1mo": 14400, "3mo": 14400,
}
_ohlcv_cache: dict = {}

def _load_ohlcv_from_db():
    """Populate in-memory cache from SQLite on startup."""
    try:
        with _db_connect() as conn:
            rows = conn.execute(
                "SELECT ticker, period, interval_val, data, cached_at FROM ohlcv_cache"
            ).fetchall()
        now = time.time()
        loaded = 0
        for r in rows:
            ttl = _CACHE_TTL.get(r["interval_val"], 3600)
            if now - r["cached_at"] < ttl:
                _ohlcv_cache[(r["ticker"], r["period"], r["interval_val"])] = {
                    "ts": r["cached_at"],
                    "data": json.loads(r["data"]),
                }
                loaded += 1
        print(f"[DB] Loaded {loaded} cached OHLCV entries from disk")
    except Exception as e:
        print(f"[DB] Failed to load OHLCV cache: {e}")

_load_ohlcv_from_db()


def _cache_get(ticker: str, period: str, interval: str):
    entry = _ohlcv_cache.get((ticker, period, interval))
    if entry and time.time() - entry["ts"] < _CACHE_TTL.get(interval, 3600):
        return entry["data"]
    return None

def _cache_set(ticker: str, period: str, interval: str, data: list):
    ts = int(time.time())
    _ohlcv_cache[(ticker, period, interval)] = {"ts": ts, "data": data}
    try:
        with _db_connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO ohlcv_cache VALUES (?,?,?,?,?)",
                (ticker, period, interval, json.dumps(data), ts)
            )
            conn.commit()
    except Exception as e:
        print(f"[DB] Cache persist error for {ticker}: {e}")


# ── Yahoo Finance batch fetch ─────────────────────────────────────────────────
def _df_to_ohlcv(df: pd.DataFrame) -> list | None:
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    if len(df) < 3:
        return None
    ohlcv = []
    for ts, row in df.iterrows():
        try:
            ohlcv.append({
                "time":  int(pd.Timestamp(ts).timestamp()),
                "open":  round(float(row["Open"]),  4),
                "high":  round(float(row["High"]),  4),
                "low":   round(float(row["Low"]),   4),
                "close": round(float(row["Close"]), 4),
            })
        except Exception:
            continue
    return ohlcv if len(ohlcv) >= 3 else None


def _download_batch_blocking(tickers: list, period: str, interval: str, max_retries: int = 3) -> dict:
    for attempt in range(max_retries):
        try:
            df = yf.download(tickers, period=period, interval=interval,
                             progress=False, auto_adjust=True)
            if df.empty:
                return {}
            results = {}
            if isinstance(df.columns, pd.MultiIndex):
                available = df.columns.get_level_values(1).unique()
                for ticker in tickers:
                    if ticker not in available:
                        continue
                    ohlcv = _df_to_ohlcv(df.xs(ticker, level=1, axis=1))
                    if ohlcv:
                        results[ticker] = ohlcv
            else:
                ohlcv = _df_to_ohlcv(df)
                if ohlcv and tickers:
                    results[tickers[0]] = ohlcv
            return results
        except Exception as e:
            name = type(e).__name__
            if "RateLimit" in name or "TooMany" in name or "429" in str(e):
                if attempt < max_retries - 1:
                    wait = 2 ** attempt + 1
                    print(f"[BATCH] Rate limited — retry {attempt+1}/{max_retries} in {wait}s")
                    time.sleep(wait)
                    continue
            print(f"[BATCH] Error: {e}")
            return {}
    return {}


# ── OHLCV API ─────────────────────────────────────────────────────────────────
class OhlcvRequest(BaseModel):
    tickers: List[str]
    period: str = "3mo"
    interval: str = "1d"

@app.post("/api/ohlcv")
async def fetch_ohlcv(req: OhlcvRequest):
    tickers = [t.strip().upper() for t in req.tickers if t.strip()]
    cached_results, to_fetch = {}, []
    for ticker in tickers:
        cached = _cache_get(ticker, req.period, req.interval)
        if cached is not None:
            cached_results[ticker] = cached
        else:
            to_fetch.append(ticker)
    fetched_results = {}
    if to_fetch:
        print(f"[BATCH] Fetching {len(to_fetch)} tickers")
        raw = await asyncio.to_thread(_download_batch_blocking, to_fetch, req.period, req.interval)
        for ticker, data in raw.items():
            _cache_set(ticker, req.period, req.interval, data)
            fetched_results[ticker] = data
    results = []
    for ticker in tickers:
        if ticker in cached_results:
            results.append({"ticker": ticker, "ohlcv": cached_results[ticker], "from_cache": True})
        elif ticker in fetched_results:
            results.append({"ticker": ticker, "ohlcv": fetched_results[ticker], "from_cache": False})
    return {"results": results}


# ── Lists API ─────────────────────────────────────────────────────────────────
class ListBody(BaseModel):
    name: str
    tickers: List[str]

class ListPatch(BaseModel):
    name: Optional[str] = None
    tickers: Optional[List[str]] = None

@app.get("/api/lists")
async def get_lists():
    rows = await _db_fetchall("SELECT * FROM ticker_lists ORDER BY created_at ASC")
    return [{"id": r["id"], "name": r["name"],
             "tickers": json.loads(r["tickers"]), "createdAt": r["created_at"]} for r in rows]

@app.post("/api/lists", status_code=201)
async def create_list(body: ListBody):
    item = {"id": _uid(), "name": body.name, "tickers": body.tickers, "createdAt": int(time.time() * 1000)}
    await _db_execute("INSERT INTO ticker_lists VALUES (?,?,?,?)",
                      (item["id"], item["name"], json.dumps(item["tickers"]), item["createdAt"]))
    return item

@app.put("/api/lists/{list_id}")
async def update_list(list_id: str, body: ListPatch):
    row = await _db_fetchone("SELECT * FROM ticker_lists WHERE id=?", (list_id,))
    if not row:
        raise HTTPException(404)
    name    = body.name    if body.name    is not None else row["name"]
    tickers = body.tickers if body.tickers is not None else json.loads(row["tickers"])
    await _db_execute("UPDATE ticker_lists SET name=?, tickers=? WHERE id=?",
                      (name, json.dumps(tickers), list_id))
    return {"ok": True}

@app.delete("/api/lists/{list_id}")
async def delete_list(list_id: str):
    await _db_execute("DELETE FROM ticker_lists WHERE id=?", (list_id,))
    return {"ok": True}


# ── Presets API ───────────────────────────────────────────────────────────────
class PresetBody(BaseModel):
    name: str
    params: dict

@app.get("/api/presets")
async def get_presets():
    rows = await _db_fetchall("SELECT * FROM presets ORDER BY created_at ASC")
    return [{"id": r["id"], "name": r["name"],
             "params": json.loads(r["params"]), "createdAt": r["created_at"]} for r in rows]

@app.post("/api/presets", status_code=201)
async def create_preset(body: PresetBody):
    item = {"id": _uid(), "name": body.name, "params": body.params, "createdAt": int(time.time() * 1000)}
    await _db_execute("INSERT INTO presets VALUES (?,?,?,?)",
                      (item["id"], item["name"], json.dumps(item["params"]), item["createdAt"]))
    return item

@app.delete("/api/presets/{preset_id}")
async def delete_preset(preset_id: str):
    await _db_execute("DELETE FROM presets WHERE id=?", (preset_id,))
    return {"ok": True}


# ── Sessions API ──────────────────────────────────────────────────────────────
class SessionBody(BaseModel):
    name: str
    period: str
    interval: str
    params: dict
    tickers: List[str]
    snapshot: List[Any]

@app.get("/api/sessions")
async def get_sessions():
    rows = await _db_fetchall("SELECT * FROM sessions ORDER BY created_at DESC")
    return [{
        "id": r["id"], "name": r["name"],
        "period": r["period"], "interval": r["interval_val"],
        "params": json.loads(r["params"]),
        "tickers": json.loads(r["tickers"]),
        "snapshot": json.loads(r["snapshot"]),
        "createdAt": r["created_at"],
    } for r in rows]

@app.post("/api/sessions", status_code=201)
async def create_session(body: SessionBody):
    item = {
        "id": _uid(), "name": body.name,
        "period": body.period, "interval": body.interval,
        "params": body.params, "tickers": body.tickers,
        "snapshot": body.snapshot, "createdAt": int(time.time() * 1000),
    }
    await _db_execute(
        "INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)",
        (item["id"], item["name"], item["period"], item["interval"],
         json.dumps(item["params"]), json.dumps(item["tickers"]),
         json.dumps(item["snapshot"]), item["createdAt"])
    )
    return item

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    await _db_execute("DELETE FROM sessions WHERE id=?", (session_id,))
    return {"ok": True}


# ── Feedback API ──────────────────────────────────────────────────────────────
class FeedbackBody(BaseModel):
    ticker: str
    vote: str
    tags: List[str]
    fingerprint: dict

@app.get("/api/feedback")
async def get_feedback():
    rows = await _db_fetchall("SELECT * FROM feedback ORDER BY created_at DESC")
    return [{
        "id": r["id"], "ticker": r["ticker"], "vote": r["vote"],
        "tags": json.loads(r["tags"]),
        "fingerprint": json.loads(r["fingerprint"]),
        "createdAt": r["created_at"],
    } for r in rows]

@app.post("/api/feedback", status_code=201)
async def upsert_feedback(body: FeedbackBody):
    item = {
        "id": _uid(), "ticker": body.ticker.upper(), "vote": body.vote,
        "tags": body.tags, "fingerprint": body.fingerprint,
        "createdAt": int(time.time() * 1000),
    }
    await _db_execute(
        "INSERT OR REPLACE INTO feedback VALUES (?,?,?,?,?,?)",
        (item["id"], item["ticker"], item["vote"],
         json.dumps(item["tags"]), json.dumps(item["fingerprint"]), item["createdAt"])
    )
    return item

@app.delete("/api/feedback/{ticker}")
async def delete_feedback(ticker: str):
    await _db_execute("DELETE FROM feedback WHERE ticker=?", (ticker.upper(),))
    return {"ok": True}

@app.delete("/api/feedback")
async def clear_feedback():
    await _db_execute("DELETE FROM feedback")
    return {"ok": True}


# ── Migration endpoint (localStorage → SQLite) ────────────────────────────────
class MigrateBody(BaseModel):
    lists:    List[Any] = []
    presets:  List[Any] = []
    sessions: List[Any] = []
    feedback: List[Any] = []

@app.post("/api/migrate")
async def migrate(body: MigrateBody):
    inserted = 0
    def _run():
        nonlocal inserted
        with _db_connect() as conn:
            for item in body.lists:
                if item.get("id") in ("default-a", "default-b"):
                    continue
                try:
                    conn.execute("INSERT OR IGNORE INTO ticker_lists VALUES (?,?,?,?)",
                                 (item["id"], item["name"],
                                  json.dumps(item.get("tickers", [])),
                                  item.get("createdAt", 0)))
                    inserted += 1
                except Exception: pass
            for item in body.presets:
                try:
                    conn.execute("INSERT OR IGNORE INTO presets VALUES (?,?,?,?)",
                                 (item["id"], item["name"],
                                  json.dumps(item.get("params", {})),
                                  item.get("createdAt", 0)))
                    inserted += 1
                except Exception: pass
            for item in body.sessions:
                try:
                    conn.execute("INSERT OR IGNORE INTO sessions VALUES (?,?,?,?,?,?,?,?)",
                                 (item["id"], item["name"],
                                  item.get("period", "3mo"),
                                  item.get("interval", "1d"),
                                  json.dumps(item.get("params", {})),
                                  json.dumps(item.get("tickers", [])),
                                  json.dumps(item.get("snapshot", [])),
                                  item.get("createdAt", 0)))
                    inserted += 1
                except Exception: pass
            for item in body.feedback:
                try:
                    conn.execute("INSERT OR IGNORE INTO feedback VALUES (?,?,?,?,?,?)",
                                 (item["id"], item.get("ticker", "").upper(),
                                  item.get("vote", "like"),
                                  json.dumps(item.get("tags", [])),
                                  json.dumps(item.get("fingerprint", {})),
                                  item.get("createdAt", 0)))
                    inserted += 1
                except Exception: pass
            conn.commit()
    await asyncio.to_thread(_run)
    return {"migrated": inserted}


# ── Serve React build ─────────────────────────────────────────────────────────
_STATIC = Path(__file__).parent / "static"
if _STATIC.exists():
    app.mount("/", StaticFiles(directory=_STATIC, html=True), name="static")
