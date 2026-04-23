import type { OHLCVBar, SRLevel, WPattern, BreakoutScore } from '../api';
import type { AnalysisParams } from '../sr';
import type { ChartFingerprint } from './preferences';

export interface TickerList {
  id: string;
  name: string;
  tickers: string[];
  createdAt: number;
}

export interface Preset {
  id: string;
  name: string;
  params: AnalysisParams;
  createdAt: number;
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  period: string;
  interval: string;
  params: AnalysisParams;
  tickers: string[];
  snapshot: { ticker: string; ohlcv?: OHLCVBar[]; sr_levels: SRLevel[]; w_patterns?: WPattern[]; score?: BreakoutScore; is_coiling?: boolean }[];
}

export interface FeedbackEntry {
  id: string;
  ticker: string;
  createdAt: number;
  vote: 'like' | 'dislike';
  tags: string[];
  fingerprint: ChartFingerprint;
}

const KEYS = {
  lists: 'sr_ticker_lists',
  presets: 'sr_presets',
  sessions: 'sr_sessions',
  feedback: 'sr_feedback',
} as const;

function load<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]');
  } catch {
    return [];
  }
}

function save<T>(key: string, data: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('[storage] localStorage write failed:', e);
    throw e;
  }
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Lists ──────────────────────────────────────────────────────────────────────

const LIST_A = 'CCEP,PAA,PLTR,AAL,AAPL,ABNB,ACGL,ADBE,ADI,ADP,ADSK,AEP,AGNC,AKAM,ALGN,ALNY,AMAT,AMD,AMGN,AMZN,APA,APPS,ARCC,ASML,AVGO,AVT,AXON,BIDU,BIIB,BILI,BKNG,BKR,BLDP,BLNK,BMRN,BNTX,BRKR,BYND,CAKE,CBRL,CDNS,CDW,CGC,CGNX,CHKP,CHRW,CHTR,CINF,CLSK,CMCSA,CME,COIN,COST,CPRT,CRSP,CRTO,CRWD,CSCO,CTAS,CTSH,CZR,DBX,DDOG,DKNG,DLTR,DOCU,DOX,DPZ,DXCM,EA,EBAY,EEFT,ENPH,EQIX,EXEL,EXPE,FANG,FAST,FCEL,FITB,FIVE,FLEX,FOX,FOXA,FSLR,FTNT,GDS,GILD,GLPI,GNTX,GOOG,GOOGL,GPRO,GT,HAS,HBAN,HOLX,HON,HOOD,HSIC,HST,HTHT,IAC,IDXX,ILMN,INCY,INO,INTC,INTU,IOVA,IPGP,IQ,ISRG,JAZZ,JBHT,JBLU,JD,JKHY,KHC,KLAC,LBTYA,LBTYK,LCID,LECO,LI,LKQ,LNT,LOGI,LRCX,LULU,LYFT,MAR,MASI,MAT,MCHP,MDB,MDLZ,MELI,META,MKTX,MLCO,MNST,MOMO,MPWR,MRNA,MRVL,MSFT,MSTR,MTCH,MU,NAVI,NBIX,NDAQ,NDSN,NFLX,NKTR,NMRK,NTAP,NTES,NTLA,NTRS,NVAX,NVDA,NWL,NWS,NWSA,NXPI,ODFL,OKTA,OLED,ON,ONC,OPK,ORLY,OTEX,PAYX,PCAR,PDBC,PDD,PENN,PEP,PFG,PLAY,PLUG,POOL,PSEC,PARA,PTC,PTON,PYPL,QCOM,QRVO,REG,REGN,RGLD,RIOT,RIVN,RKLB,ROKU,ROST,RYAAY,SABR,SBAC,SBUX,SEDG,SIRI,SLM,SNPS,SOHU,SONO,SPWR,SQQQ,SRPT,SSNC,STLD,STNE,STX,SVC,SWKS,TCOM,TEAM,TER,TLRY,TMUS,TRIP,TRMB,TROW,TSCO,TSLA,TTD,TTEK,TTWO,TXN,TXRH,UAL,ULTA,VEON,VOD,VRSK,VRSN,VRTX,VTRS,WB,WDC,WEN,WKHS,WVE,WYNN,XRAY,XRX,Z,ZBRA,ZION,ZM,ZS';
const LIST_B = 'AIR,ATI,DBI,A,AA,AAP,ABBV,ABEV,ABT,ACM,ACN,ADM,AEE,AEM,AEO,AES,AFG,AFL,AGCO,AGO,AIG,AIZ,AJG,ALB,ALK,ALL,ALLE,ALLY,ALSN,AME,AMG,AMP,AMX,AN,ANET,ANF,AON,AOS,APD,APH,APTV,AR,ARW,ATHM,ATO,AWK,AXP,AYI,AZO,BA,BABA,BAC,BAH,BALL,BAP,BAX,BB,BBY,BC,BCE,BDX,BEN,BG,BHC,BIO,BK,BLK,BMO,BMY,BNS,BR,BRO,BSAC,BSX,BUD,BURL,BWA,BX,C,CAG,CAH,CARR,CAT,CB,CBRE,CCJ,CCK,CCL,CCU,CE,CF,CFG,CHD,CHGG,CHWY,CI,CIB,CIEN,CL,CLF,CLX,CMG,CMI,CMS,CNC,CNP,CNQ,COF,COP,COTY,CP,CPA,CPRI,CR,CRL,CRM,CTRA,CVE,CVI,CVS,CVX,CX,D,DAL,DD,DE,DECK,DELL,DG,DGX,DHI,DHR,DIS,DLB,DOV,DTE,DUK,DVA,DVN,DXC,EC,ECL,ED,EFX,EIX,EL,EMN,EMR,ENB,EOG,EPD,EQT,ES,ESNT,ETN,ETR,EW,F,FAF,FCX,FDS,FDX,FE,FHN,FIS,FLO,FLR,FLS,FMC,FMX,FNB,FNV,FTI,FTV,FVRR,GD,GE,GGB,GGG,GHC,GIL,GIS,GL,GLOB,GLW,GM,GNRC,GPC,GPK,GPN,GS,GSK,GWW,H,HAL,HCA,HD,HDB,HEI,HIG,HII,HLT,HMC,HOG,HP,HPE,HPQ,HRB,HRL,HSBC,HSY,HUM,HUN,HWM,HXL,IBM,IBN,ICE,IFF,INFY,INGR,IP,IQV,IR,IT,ITT,ITUB,ITW,IVZ,J,JBL,JCI,JEF,JMIA,JNJ,KEY,KEYS,KGC,KKR,KMI,KMX,KO,KOF,KR,KSS,L,LAC,LAZ,LDOS,LEA,LEG,LEN,LH,LHX,LII,LLY,LMT,LNC,LOW,LUMN,LUV,LVS,LYB,LYV,M,MA,MAN,MANU,MAS,MCD,MCK,MCO,MDT,MDU,MET,MFC,MGA,MGM,MHK,MKC,MKL,MLM,MMM,MO,MOH,MOS,MPC,MPLX,MRK,MS,MSCI,MSI,MSM,MTD,MTG,MUR,NEE,NEM,NEU,NI,NIO,NKE,NOC,NOK,NOW,NRG,NSC,NUE,NUS,NVS,OC,OGE,OKE,OMC,ORCL,OSK,OXY,PAGS,PAYC,PBR,PCG,PFE,PG,PH,PHM,PINS,PKG,PM,PNR,PNW,PPL,PRGO,PRU,PSX,QSR,RACE,RBLX,RCL,RF,RHI,RL,RNG,RNR,ROK,RRC,RS,RSG,SAP,SCHW,SE,SIG,SMG,SNAP,SNOW,SO,SONY,SPCE,SPGI,SPOT,SQM,STLA,STT,STZ,SU,SYY,T,TAL,TD,TGT,TM,TOL,TPR,TSM,TTC,TWLO,TXT,GRMN,VIRT';

function parseList(raw: string): string[] {
  return raw.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
}

export function getLists(): TickerList[] {
  const stored = load<TickerList>(KEYS.lists);
  if (stored.length === 0) {
    const defaults: TickerList[] = [
      { id: 'default-a', name: 'Liste NASDAQ Tech', tickers: parseList(LIST_A), createdAt: 0 },
      { id: 'default-b', name: 'Liste NYSE/Large Cap', tickers: parseList(LIST_B), createdAt: 0 },
    ];
    save(KEYS.lists, defaults);
    return defaults;
  }
  return stored;
}

export function saveList(name: string, tickers: string[]): TickerList {
  const lists = getLists();
  const item: TickerList = { id: uid(), name, tickers, createdAt: Date.now() };
  save(KEYS.lists, [...lists, item]);
  return item;
}

export function updateList(id: string, patch: Partial<Pick<TickerList, 'name' | 'tickers'>>) {
  save(KEYS.lists, getLists().map(l => l.id === id ? { ...l, ...patch } : l));
}

export function deleteList(id: string) {
  save(KEYS.lists, getLists().filter(l => l.id !== id));
}

// ── Presets ────────────────────────────────────────────────────────────────────

export function getPresets(): Preset[] {
  return load<Preset>(KEYS.presets);
}

export function savePreset(name: string, params: AnalysisParams): Preset {
  const presets = getPresets();
  const item: Preset = { id: uid(), name, params, createdAt: Date.now() };
  save(KEYS.presets, [...presets, item]);
  return item;
}

export function deletePreset(id: string) {
  save(KEYS.presets, getPresets().filter(p => p.id !== id));
}

// ── Sessions ───────────────────────────────────────────────────────────────────

export function getSessions(): Session[] {
  return load<Session>(KEYS.sessions);
}

export function saveSession(
  name: string,
  period: string,
  interval: string,
  params: AnalysisParams,
  snapshot: Session['snapshot']
): Session {
  const sessions = getSessions();
  // Strip OHLCV from snapshot — too heavy for localStorage (≈2MB for 378 tickers).
  // Restore will re-fetch from Yahoo Finance using the saved tickers list.
  const lightSnapshot = snapshot.map(({ ohlcv: _ohlcv, ...rest }) => rest);
  const tickers = snapshot.map(r => r.ticker);
  const item: Session = { id: uid(), name, createdAt: Date.now(), period, interval, params, tickers, snapshot: lightSnapshot };
  save(KEYS.sessions, [item, ...sessions]);
  return item;
}

export function deleteSession(id: string) {
  save(KEYS.sessions, getSessions().filter(s => s.id !== id));
}

// ── Feedback ───────────────────────────────────────────────────────────────────

export function getFeedback(): FeedbackEntry[] {
  return load<FeedbackEntry>(KEYS.feedback);
}

export function upsertFeedback(
  ticker: string,
  vote: 'like' | 'dislike',
  tags: string[],
  fingerprint: ChartFingerprint,
): FeedbackEntry {
  const all = getFeedback().filter(f => f.ticker !== ticker);
  const item: FeedbackEntry = { id: uid(), ticker, createdAt: Date.now(), vote, tags, fingerprint };
  save(KEYS.feedback, [item, ...all]);
  return item;
}

export function removeFeedback(ticker: string) {
  save(KEYS.feedback, getFeedback().filter(f => f.ticker !== ticker));
}

export function clearFeedback() {
  save(KEYS.feedback, []);
}
