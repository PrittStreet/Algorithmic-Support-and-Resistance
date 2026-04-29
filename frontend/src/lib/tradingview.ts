export const TV_INTERVAL_MAP: Record<string, string> = {
  '1m':  '1',
  '5m':  '5',
  '15m': '15',
  '30m': '30',
  '1h':  '60',
  '4h':  '240',
  '1d':  'D',
  '1wk': 'W',
  '1mo': 'M',
};

export function tradingViewUrl(ticker: string, interval: string): string {
  const tvInterval = TV_INTERVAL_MAP[interval] ?? 'D';
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(ticker)}&interval=${tvInterval}`;
}

export function tradingViewEmbedUrl(ticker: string, interval: string): string {
  const tvInterval = TV_INTERVAL_MAP[interval] ?? 'D';
  const params = new URLSearchParams({
    symbol: ticker,
    interval: tvInterval,
    theme: 'dark',
    style: '1',
    locale: 'fr',
    hidesidetoolbar: '0',
    symboledit: '0',
    saveimage: '1',
    timezone: 'Europe/Paris',
  });
  return `https://www.tradingview.com/widgetembed/?${params}`;
}
