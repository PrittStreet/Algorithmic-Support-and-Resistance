import time
import asyncio
import json
import re
import sqlite3
import uuid
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
import yfinance as yf
import pandas as pd
from typing import List, Optional, Any

app = FastAPI(title="S/R Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Validation constants
_TICKER_RE = re.compile(r"^[A-Z0-9.\^\-]{1,10}$")
_MAX_TICKERS_PER_REQUEST = 500
_MAX_NAME_LEN = 80
_VALID_PERIODS   = {"1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"}
_VALID_INTERVALS = {"1m","2m","5m","15m","30m","60m","90m","1h","1d","5d","1wk","1mo","3mo"}

def _norm_tickers(tickers: List[str]) -> List[str]:
    out = []
    for t in tickers:
        if not isinstance(t, str):
            continue
        u = t.strip().upper()
        if u and _TICKER_RE.match(u):
            out.append(u)
    if len(out) > _MAX_TICKERS_PER_REQUEST:
        raise HTTPException(400, f"Trop de tickers (max {_MAX_TICKERS_PER_REQUEST})")
    return out

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
                created_at  INTEGER NOT NULL,
                annotation  TEXT
            );
            CREATE TABLE IF NOT EXISTS ohlcv_cache (
                ticker       TEXT NOT NULL,
                period       TEXT NOT NULL,
                interval_val TEXT NOT NULL,
                data         TEXT NOT NULL,
                cached_at    INTEGER NOT NULL,
                PRIMARY KEY (ticker, period, interval_val)
            );
            CREATE TABLE IF NOT EXISTS favorites (
                ticker       TEXT NOT NULL,
                period       TEXT NOT NULL,
                interval_val TEXT NOT NULL,
                note         TEXT,
                created_at   INTEGER NOT NULL,
                PRIMARY KEY (ticker, period, interval_val)
            );
            CREATE TABLE IF NOT EXISTS trade_references (
                id           TEXT PRIMARY KEY,
                ticker       TEXT NOT NULL,
                date_in      TEXT NOT NULL,
                date_out     TEXT NOT NULL,
                interval_val TEXT NOT NULL,
                notes        TEXT,
                created_at   INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pattern_annotations (
                id           TEXT PRIMARY KEY,
                trade_ref_id TEXT NOT NULL,
                pattern_type TEXT NOT NULL,
                points       TEXT NOT NULL,
                created_at   INTEGER NOT NULL
            );
        """)
        # Migration: add annotation column to pre-existing feedback tables
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(feedback)").fetchall()]
        if "annotation" not in cols:
            conn.execute("ALTER TABLE feedback ADD COLUMN annotation TEXT")
        # Migration: old W annotations had 4 points; new W has 5 → 4-pt W don't fit → Custom.
        conn.execute("""
            UPDATE pattern_annotations
            SET pattern_type = 'Custom'
            WHERE pattern_type = 'W'
              AND json_array_length(points) = 4
        """)
        # Migration: 'Double Bottom' was an interim type, now removed → preserve as Custom.
        conn.execute("""
            UPDATE pattern_annotations
            SET pattern_type = 'Custom'
            WHERE pattern_type = 'Double Bottom'
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
    """Populate in-memory cache from SQLite on startup; purge expired rows from disk."""
    try:
        with _db_connect() as conn:
            rows = conn.execute(
                "SELECT ticker, period, interval_val, data, cached_at FROM ohlcv_cache"
            ).fetchall()
            now = time.time()
            loaded = 0
            expired: list[tuple] = []
            for r in rows:
                ttl = _CACHE_TTL.get(r["interval_val"], 3600)
                age = now - r["cached_at"]
                if age >= ttl:
                    expired.append((r["ticker"], r["period"], r["interval_val"]))
                    continue
                data = json.loads(r["data"])
                # Skip pre-volume entries (migration guard)
                if data and isinstance(data[0], dict) and "volume" not in data[0]:
                    expired.append((r["ticker"], r["period"], r["interval_val"]))
                    continue
                _ohlcv_cache[(r["ticker"], r["period"], r["interval_val"])] = {
                    "ts": r["cached_at"],
                    "data": data,
                }
                loaded += 1
            if expired:
                conn.executemany(
                    "DELETE FROM ohlcv_cache WHERE ticker=? AND period=? AND interval_val=?",
                    expired,
                )
                conn.commit()
        print(f"[DB] Loaded {loaded} cached OHLCV entries, purged {len(expired)} expired")
    except Exception as e:
        print(f"[DB] Failed to load OHLCV cache: {e}")

_load_ohlcv_from_db()


def _cache_get(ticker: str, period: str, interval: str):
    entry = _ohlcv_cache.get((ticker, period, interval))
    if not entry or time.time() - entry["ts"] >= _CACHE_TTL.get(interval, 3600):
        return None
    data = entry["data"]
    # Invalidate pre-volume cache entries (migration: old bars have no "volume" key)
    if data and isinstance(data[0], dict) and "volume" not in data[0]:
        del _ohlcv_cache[(ticker, period, interval)]
        return None
    return data

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
    has_volume = "Volume" in df.columns
    ohlcv = []
    for ts, row in df.iterrows():
        try:
            bar: dict = {
                "time":  int(pd.Timestamp(ts).timestamp()),
                "open":  round(float(row["Open"]),  4),
                "high":  round(float(row["High"]),  4),
                "low":   round(float(row["Low"]),   4),
                "close": round(float(row["Close"]), 4),
            }
            if has_volume:
                vol = row.get("Volume", 0)
                if vol and vol > 0:
                    bar["volume"] = int(vol)
            ohlcv.append(bar)
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


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "cache_entries": len(_ohlcv_cache),
        "ts": int(time.time()),
    }


# ── OHLCV API ─────────────────────────────────────────────────────────────────
class OhlcvRequest(BaseModel):
    tickers: List[str] = Field(..., max_length=_MAX_TICKERS_PER_REQUEST)
    period: str = "3mo"
    interval: str = "1d"

    @field_validator("period")
    @classmethod
    def _check_period(cls, v: str) -> str:
        if v not in _VALID_PERIODS:
            raise ValueError(f"période invalide: {v}")
        return v

    @field_validator("interval")
    @classmethod
    def _check_interval(cls, v: str) -> str:
        if v not in _VALID_INTERVALS:
            raise ValueError(f"intervalle invalide: {v}")
        return v

@app.post("/api/ohlcv")
async def fetch_ohlcv(req: OhlcvRequest):
    tickers = _norm_tickers(req.tickers)
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
    name: str = Field(..., min_length=1, max_length=_MAX_NAME_LEN)
    tickers: List[str] = Field(..., max_length=_MAX_TICKERS_PER_REQUEST)

class ListPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=_MAX_NAME_LEN)
    tickers: Optional[List[str]] = Field(None, max_length=_MAX_TICKERS_PER_REQUEST)

@app.get("/api/lists")
async def get_lists():
    rows = await _db_fetchall("SELECT * FROM ticker_lists ORDER BY created_at ASC")
    return [{"id": r["id"], "name": r["name"],
             "tickers": json.loads(r["tickers"]), "createdAt": r["created_at"]} for r in rows]

@app.post("/api/lists", status_code=201)
async def create_list(body: ListBody):
    tickers = _norm_tickers(body.tickers)
    item = {"id": _uid(), "name": body.name.strip(), "tickers": tickers, "createdAt": int(time.time() * 1000)}
    await _db_execute("INSERT INTO ticker_lists VALUES (?,?,?,?)",
                      (item["id"], item["name"], json.dumps(item["tickers"]), item["createdAt"]))
    return item

@app.put("/api/lists/{list_id}")
async def update_list(list_id: str, body: ListPatch):
    row = await _db_fetchone("SELECT * FROM ticker_lists WHERE id=?", (list_id,))
    if not row:
        raise HTTPException(404)
    name    = body.name.strip() if body.name is not None else row["name"]
    tickers = _norm_tickers(body.tickers) if body.tickers is not None else json.loads(row["tickers"])
    await _db_execute("UPDATE ticker_lists SET name=?, tickers=? WHERE id=?",
                      (name, json.dumps(tickers), list_id))
    return {"ok": True}

@app.delete("/api/lists/{list_id}")
async def delete_list(list_id: str):
    await _db_execute("DELETE FROM ticker_lists WHERE id=?", (list_id,))
    return {"ok": True}


# ── Presets API ───────────────────────────────────────────────────────────────
class PresetBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=_MAX_NAME_LEN)
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
    name: str = Field(..., min_length=1, max_length=_MAX_NAME_LEN)
    period: str
    interval: str
    params: dict
    tickers: List[str] = Field(..., max_length=_MAX_TICKERS_PER_REQUEST)
    snapshot: List[Any]

    @field_validator("period")
    @classmethod
    def _check_period(cls, v: str) -> str:
        if v not in _VALID_PERIODS:
            raise ValueError(f"période invalide: {v}")
        return v

    @field_validator("interval")
    @classmethod
    def _check_interval(cls, v: str) -> str:
        if v not in _VALID_INTERVALS:
            raise ValueError(f"intervalle invalide: {v}")
        return v

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
    ticker: str = Field(..., min_length=1, max_length=10)
    vote: str
    tags: List[str] = Field(default_factory=list, max_length=20)
    fingerprint: dict
    annotation: Optional[dict] = None

    @field_validator("vote")
    @classmethod
    def _check_vote(cls, v: str) -> str:
        if v not in ("like", "dislike"):
            raise ValueError("vote doit être 'like' ou 'dislike'")
        return v

    @field_validator("ticker")
    @classmethod
    def _check_ticker(cls, v: str) -> str:
        u = v.strip().upper()
        if not _TICKER_RE.match(u):
            raise ValueError(f"ticker invalide: {v}")
        return u

@app.get("/api/feedback")
async def get_feedback():
    rows = await _db_fetchall("SELECT * FROM feedback ORDER BY created_at DESC")
    return [{
        "id": r["id"], "ticker": r["ticker"], "vote": r["vote"],
        "tags": json.loads(r["tags"]),
        "fingerprint": json.loads(r["fingerprint"]),
        "createdAt": r["created_at"],
        "annotation": json.loads(r["annotation"]) if r["annotation"] else None,
    } for r in rows]

@app.post("/api/feedback", status_code=201)
async def upsert_feedback(body: FeedbackBody):
    item = {
        "id": _uid(), "ticker": body.ticker.upper(), "vote": body.vote,
        "tags": body.tags, "fingerprint": body.fingerprint,
        "createdAt": int(time.time() * 1000),
        "annotation": body.annotation,
    }
    await _db_execute(
        "INSERT OR REPLACE INTO feedback VALUES (?,?,?,?,?,?,?)",
        (item["id"], item["ticker"], item["vote"],
         json.dumps(item["tags"]), json.dumps(item["fingerprint"]), item["createdAt"],
         json.dumps(item["annotation"]) if item["annotation"] else None)
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


# ── Favorites API ─────────────────────────────────────────────────────────────
class FavoriteBody(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10)
    period: str
    interval: str
    note: Optional[str] = Field(None, max_length=200)

    @field_validator("ticker")
    @classmethod
    def _check_ticker(cls, v: str) -> str:
        u = v.strip().upper()
        if not _TICKER_RE.match(u):
            raise ValueError(f"ticker invalide: {v}")
        return u

    @field_validator("period")
    @classmethod
    def _check_period(cls, v: str) -> str:
        if v not in _VALID_PERIODS:
            raise ValueError(f"période invalide: {v}")
        return v

    @field_validator("interval")
    @classmethod
    def _check_interval(cls, v: str) -> str:
        if v not in _VALID_INTERVALS:
            raise ValueError(f"intervalle invalide: {v}")
        return v

class FavoriteNotePatch(BaseModel):
    note: Optional[str] = Field(None, max_length=200)

@app.get("/api/favorites")
async def get_favorites():
    rows = await _db_fetchall("SELECT * FROM favorites ORDER BY created_at DESC")
    return [{
        "ticker": r["ticker"], "period": r["period"], "interval": r["interval_val"],
        "note": r["note"], "createdAt": r["created_at"],
    } for r in rows]

@app.post("/api/favorites", status_code=201)
async def upsert_favorite(body: FavoriteBody):
    item = {
        "ticker": body.ticker, "period": body.period, "interval": body.interval,
        "note": body.note, "createdAt": int(time.time() * 1000),
    }
    await _db_execute(
        "INSERT OR REPLACE INTO favorites VALUES (?,?,?,?,?)",
        (item["ticker"], item["period"], item["interval"], item["note"], item["createdAt"])
    )
    return item

@app.patch("/api/favorites/{ticker}/{period}/{interval}")
async def update_favorite_note(ticker: str, period: str, interval: str, body: FavoriteNotePatch):
    ticker = ticker.upper()
    if not _TICKER_RE.match(ticker) or period not in _VALID_PERIODS or interval not in _VALID_INTERVALS:
        raise HTTPException(400, "clé invalide")
    await _db_execute(
        "UPDATE favorites SET note=? WHERE ticker=? AND period=? AND interval_val=?",
        (body.note, ticker, period, interval),
    )
    return {"ok": True}

@app.delete("/api/favorites/{ticker}/{period}/{interval}")
async def delete_favorite(ticker: str, period: str, interval: str):
    await _db_execute(
        "DELETE FROM favorites WHERE ticker=? AND period=? AND interval_val=?",
        (ticker.upper(), period, interval),
    )
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
                    ann = item.get("annotation")
                    conn.execute("INSERT OR IGNORE INTO feedback VALUES (?,?,?,?,?,?,?)",
                                 (item["id"], item.get("ticker", "").upper(),
                                  item.get("vote", "like"),
                                  json.dumps(item.get("tags", [])),
                                  json.dumps(item.get("fingerprint", {})),
                                  item.get("createdAt", 0),
                                  json.dumps(ann) if ann else None))
                    inserted += 1
                except Exception: pass
            conn.commit()
    await asyncio.to_thread(_run)
    return {"migrated": inserted}


# ── OHLCV range (date-based) ──────────────────────────────────────────────────
class OhlcvRangeRequest(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10)
    date_in: str   # ISO date YYYY-MM-DD
    date_out: str  # ISO date YYYY-MM-DD
    interval: str = "1d"

    @field_validator("ticker")
    @classmethod
    def _check_ticker(cls, v: str) -> str:
        u = v.strip().upper()
        if not _TICKER_RE.match(u):
            raise ValueError(f"ticker invalide: {v}")
        return u

    @field_validator("interval")
    @classmethod
    def _check_interval(cls, v: str) -> str:
        if v not in _VALID_INTERVALS:
            raise ValueError(f"intervalle invalide: {v}")
        return v

@app.post("/api/ohlcv-range")
async def fetch_ohlcv_range(req: OhlcvRangeRequest):
    def _run():
        import datetime
        # yfinance `end` is exclusive — add 1 day so date_out is included
        end_date = (datetime.date.fromisoformat(req.date_out) + datetime.timedelta(days=1)).isoformat()
        try:
            df = yf.download(
                req.ticker, start=req.date_in, end=end_date,
                interval=req.interval, progress=False, auto_adjust=True,
            )
            if df.empty:
                return None
            if isinstance(df.columns, pd.MultiIndex):
                df = df.xs(req.ticker, level=1, axis=1)
            return _df_to_ohlcv(df)
        except Exception as e:
            print(f"[RANGE] Error fetching {req.ticker}: {e}")
            return None

    ohlcv = await asyncio.to_thread(_run)
    if ohlcv is None:
        raise HTTPException(404, f"Aucune donnée pour {req.ticker} sur la période demandée")
    return {"ticker": req.ticker, "ohlcv": ohlcv}


# ── Trade References API ───────────────────────────────────────────────────────
class TradeRefBody(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10)
    date_in: str
    date_out: str
    interval: str = "1d"
    notes: Optional[str] = Field(None, max_length=500)

    @field_validator("ticker")
    @classmethod
    def _check_ticker(cls, v: str) -> str:
        u = v.strip().upper()
        if not _TICKER_RE.match(u):
            raise ValueError(f"ticker invalide: {v}")
        return u

    @field_validator("interval")
    @classmethod
    def _check_interval(cls, v: str) -> str:
        if v not in _VALID_INTERVALS:
            raise ValueError(f"intervalle invalide: {v}")
        return v

@app.get("/api/trade-references")
async def get_trade_references():
    rows = await _db_fetchall("SELECT * FROM trade_references ORDER BY created_at DESC")
    return [{
        "id": r["id"], "ticker": r["ticker"],
        "dateIn": r["date_in"], "dateOut": r["date_out"],
        "interval": r["interval_val"],
        "notes": r["notes"], "createdAt": r["created_at"],
    } for r in rows]

@app.post("/api/trade-references", status_code=201)
async def create_trade_reference(body: TradeRefBody):
    item = {
        "id": _uid(), "ticker": body.ticker.upper(),
        "dateIn": body.date_in, "dateOut": body.date_out,
        "interval": body.interval, "notes": body.notes,
        "createdAt": int(time.time() * 1000),
    }
    await _db_execute(
        "INSERT INTO trade_references VALUES (?,?,?,?,?,?,?)",
        (item["id"], item["ticker"], item["dateIn"], item["dateOut"],
         item["interval"], item["notes"], item["createdAt"])
    )
    return item

@app.delete("/api/trade-references/{ref_id}")
async def delete_trade_reference(ref_id: str):
    await _db_execute("DELETE FROM pattern_annotations WHERE trade_ref_id=?", (ref_id,))
    await _db_execute("DELETE FROM trade_references WHERE id=?", (ref_id,))
    return {"ok": True}


# ── Pattern Annotations API ────────────────────────────────────────────────────
class AnnotationBody(BaseModel):
    trade_ref_id: str
    pattern_type: str = Field(..., min_length=1, max_length=50)
    points: List[Any] = Field(..., max_length=20)

@app.get("/api/pattern-annotations")
async def get_pattern_annotations(trade_ref_id: Optional[str] = None):
    if trade_ref_id:
        rows = await _db_fetchall(
            "SELECT * FROM pattern_annotations WHERE trade_ref_id=? ORDER BY created_at DESC",
            (trade_ref_id,)
        )
    else:
        rows = await _db_fetchall("SELECT * FROM pattern_annotations ORDER BY created_at DESC")
    return [{
        "id": r["id"], "tradeRefId": r["trade_ref_id"],
        "patternType": r["pattern_type"],
        "points": json.loads(r["points"]),
        "createdAt": r["created_at"],
    } for r in rows]

@app.post("/api/pattern-annotations", status_code=201)
async def upsert_pattern_annotation(body: AnnotationBody):
    ref = await _db_fetchone("SELECT id FROM trade_references WHERE id=?", (body.trade_ref_id,))
    if not ref:
        raise HTTPException(404, "Référence de trade introuvable")
    # One annotation per (trade_ref_id, pattern_type) — upsert logic
    existing = await _db_fetchone(
        "SELECT id FROM pattern_annotations WHERE trade_ref_id=? AND pattern_type=?",
        (body.trade_ref_id, body.pattern_type)
    )
    now = int(time.time() * 1000)
    if existing:
        ann_id = existing["id"]
        await _db_execute(
            "UPDATE pattern_annotations SET points=?, created_at=? WHERE id=?",
            (json.dumps(body.points), now, ann_id)
        )
    else:
        ann_id = _uid()
        await _db_execute(
            "INSERT INTO pattern_annotations VALUES (?,?,?,?,?)",
            (ann_id, body.trade_ref_id, body.pattern_type, json.dumps(body.points), now)
        )
    return {
        "id": ann_id, "tradeRefId": body.trade_ref_id,
        "patternType": body.pattern_type,
        "points": body.points, "createdAt": now,
    }

@app.delete("/api/pattern-annotations/{ann_id}")
async def delete_pattern_annotation(ann_id: str):
    await _db_execute("DELETE FROM pattern_annotations WHERE id=?", (ann_id,))
    return {"ok": True}


# ── Serve React build ─────────────────────────────────────────────────────────
_STATIC = Path(__file__).parent / "static"
if _STATIC.exists():
    app.mount("/", StaticFiles(directory=_STATIC, html=True), name="static")
