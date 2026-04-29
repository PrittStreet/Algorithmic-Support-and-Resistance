import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { tradingViewEmbedUrl } from '../lib/tradingview';

interface Props {
  ticker: string;
  interval: string;
  onClose: () => void;
}

export function TVChartModal({ ticker, interval, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    const prevOverflow = document.body.style.overflow;
    const prevVisibility = document.documentElement.style.getPropertyValue('--app-root-visibility');
    document.body.style.overflow = 'hidden';
    const appRoot = document.getElementById('root');
    if (appRoot) appRoot.style.visibility = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
      if (appRoot) appRoot.style.visibility = prevVisibility || 'visible';
    };
  }, [onClose]);

  return createPortal(
    <div
      className="flex flex-col bg-slate-950"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        isolation: 'isolate',
        visibility: 'visible',
      }}
    >
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold font-mono text-sm">{ticker}</span>
          <span className="text-slate-500 text-xs">{interval}</span>
          <span className="text-xs text-slate-600 italic">TradingView</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white text-sm px-3 py-1 rounded hover:bg-slate-800 transition-colors border border-slate-700"
          title="Fermer (Échap)"
        >✕ Fermer</button>
      </div>
      <iframe
        src={tradingViewEmbedUrl(ticker, interval)}
        className="flex-1 w-full border-0"
        allow="fullscreen"
        allowFullScreen
        scrolling="no"
        title={`TradingView — ${ticker} ${interval}`}
      />
    </div>,
    document.body
  );
}
