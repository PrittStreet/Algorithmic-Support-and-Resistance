import type { SeriesAttachedParameter, Time, IChartApi } from 'lightweight-charts';

export interface ZoneData {
  startTime: Time;
  endTime: Time;
  upper: number;
  lower: number;
  fillColor: string;
  opacity: number;
}

export class SRZonePrimitive {
  data: ZoneData;
  private _priceToCoord?: (p: number) => number | null;
  private _chart?: IChartApi;

  constructor(data: ZoneData) {
    this.data = data;
  }

  attached(params: SeriesAttachedParameter<Time>): void {
    this._priceToCoord = (p) => params.series.priceToCoordinate(p) as number | null;
    this._chart = params.chart;
  }

  detached(): void {
    this._priceToCoord = undefined;
    this._chart = undefined;
  }

  updateAllViews(): void {}

  paneViews() {
    const ptc = this._priceToCoord;
    const chart = this._chart;
    if (!ptc || !chart) return [];
    const { startTime, endTime, upper, lower, fillColor, opacity } = this.data;

    return [{
      zOrder: () => 'bottom' as const,
      renderer: () => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        draw: (target: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          target.useMediaCoordinateSpace((scope: any) => {
            const { context: ctx, mediaSize } = scope as {
              context: CanvasRenderingContext2D;
              mediaSize: { width: number; height: number };
            };
            const x1 = chart.timeScale().timeToCoordinate(startTime) as number | null;
            const x2 = chart.timeScale().timeToCoordinate(endTime) as number | null;
            const y1 = ptc(upper);
            const y2 = ptc(lower);
            if (y1 === null || y2 === null) return;
            const left  = x1 !== null ? x1 : 0;
            const right = x2 !== null ? x2 : mediaSize.width;
            ctx.save();
            ctx.globalAlpha = opacity;
            ctx.fillStyle   = fillColor;
            ctx.fillRect(left, Math.min(y1, y2), right - left, Math.abs(y2 - y1));
            ctx.restore();
          });
        },
      }),
    }];
  }
}
