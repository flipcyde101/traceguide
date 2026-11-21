export interface BlurBox {
  xPercent: number;
  yPercent: number;
  wPercent: number;
  hPercent: number;
  reason: string;
}

export interface GuideStep {
  index: number;
  action: string;
  title: string;
  detail: string;
  selector?: string;
  url?: string;
  timestampMs: number;
  clickXPercent?: number;
  clickYPercent?: number;
  viewportWidth: number;
  viewportHeight: number;
  frameMime?: string;
  frameDataUri?: string;
  blurBoxes: BlurBox[];
  redactedCount: number;
}

export interface Guide {
  id: string;
  title: string;
  sourceFile: string;
  createdAt: string;
  viewportWidth: number;
  viewportHeight: number;
  redactedTotal: number;
  /** Missing for older guides. Only an explicit false may export screenshots. */
  screenshotsOmitted?: boolean;
  steps: GuideStep[];
}

export interface TraceParseOptions {
  title?: string;
  sourceFile?: string;
  redactPii?: boolean;
  maxSteps?: number;
}
