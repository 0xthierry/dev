import { TOKEN_TIMESTAMP_COMPACTION_THRESHOLD, TPS_WINDOW_MS } from "./constants";
import type { TokenSpeedMeasurement } from "./types";

export type Clock = () => number;
export type TokenSpeedSnapshotMode = "current" | "average";

export class TokenSpeedEngine {
  private streaming = false;
  private tokens = 0;
  private startedAt: number | undefined;
  private endedAt: number | undefined;
  private tokenTimestamps: number[] = [];
  private windowStartIndex = 0;

  constructor(
    private readonly now: Clock = Date.now,
    private readonly windowMs: number = TPS_WINDOW_MS,
    private readonly compactionThreshold: number = TOKEN_TIMESTAMP_COMPACTION_THRESHOLD,
  ) {}

  get isStreaming(): boolean {
    return this.streaming;
  }

  get tokenCount(): number {
    return this.tokens;
  }

  get elapsedMs(): number {
    return this.elapsedMsAt(this.now());
  }

  get elapsedSeconds(): number {
    return this.elapsedMs / 1_000;
  }

  start(): void {
    const timestamp = this.now();
    this.streaming = true;
    this.tokens = 0;
    this.startedAt = timestamp;
    this.endedAt = undefined;
    this.tokenTimestamps = [];
    this.windowStartIndex = 0;
  }

  recordTokens(count = 1): void {
    if (!this.streaming) return;

    const tokenCount = Math.floor(count);
    if (tokenCount <= 0) return;

    const timestamp = this.now();
    this.tokens += tokenCount;
    for (let index = 0; index < tokenCount; index++) {
      this.tokenTimestamps.push(timestamp);
    }

    if (this.windowStartIndex >= this.compactionThreshold) this.compactTimestamps();
  }

  snapshot(mode: TokenSpeedSnapshotMode = "current"): TokenSpeedMeasurement {
    const timestamp = this.now();
    const tps = mode === "average" ? this.averageTpsAt(timestamp) : this.currentTpsAt(timestamp);

    return {
      tps,
      tokenCount: this.tokens,
      elapsedSeconds: this.elapsedMsAt(timestamp) / 1_000,
    };
  }

  stop(): TokenSpeedMeasurement {
    if (this.streaming) this.endedAt = this.now();

    const measurement = this.snapshot("average");
    this.streaming = false;
    this.tokenTimestamps = [];
    this.windowStartIndex = 0;
    return measurement;
  }

  reset(): void {
    this.streaming = false;
    this.tokens = 0;
    this.startedAt = undefined;
    this.endedAt = undefined;
    this.tokenTimestamps = [];
    this.windowStartIndex = 0;
  }

  private currentTpsAt(timestamp: number): number {
    if (this.tokens === 0) return 0;

    const elapsedMs = this.elapsedMsAt(timestamp);
    if (elapsedMs < this.windowMs) return this.averageTpsAt(timestamp);

    const windowStart = timestamp - this.windowMs;
    while (
      this.windowStartIndex < this.tokenTimestamps.length &&
      (this.tokenTimestamps[this.windowStartIndex] ?? 0) < windowStart
    ) {
      this.windowStartIndex++;
    }

    const windowTokenCount = this.tokenTimestamps.length - this.windowStartIndex;
    if (windowTokenCount <= 0) return this.averageTpsAt(timestamp);

    const firstWindowToken = this.tokenTimestamps[this.windowStartIndex] ?? timestamp;
    const windowDurationMs = Math.max(1, timestamp - firstWindowToken);
    return windowTokenCount / (windowDurationMs / 1_000);
  }

  private averageTpsAt(timestamp: number): number {
    if (this.tokens === 0) return 0;

    const elapsedSeconds = this.elapsedMsAt(timestamp) / 1_000;
    if (elapsedSeconds <= 0) return 0;

    return this.tokens / elapsedSeconds;
  }

  private elapsedMsAt(timestamp: number): number {
    if (this.startedAt === undefined) return 0;
    return Math.max(0, (this.endedAt ?? timestamp) - this.startedAt);
  }

  private compactTimestamps(): void {
    if (this.windowStartIndex === 0) return;

    this.tokenTimestamps = this.tokenTimestamps.slice(this.windowStartIndex);
    this.windowStartIndex = 0;
  }
}
