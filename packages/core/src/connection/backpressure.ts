import type { BackpressureOptions } from '../shared/types'

export class BackpressureTracker {
  private highWater = false

  constructor(readonly options: Readonly<BackpressureOptions>) {}

  update(bufferedAmount: number): boolean {
    if (!Number.isFinite(bufferedAmount) || bufferedAmount < 0)
      bufferedAmount = 0
    if (this.highWater) {
      if (bufferedAmount <= this.options.lowWaterMarkBytes)
        this.highWater = false
    }
    else if (bufferedAmount >= this.options.highWaterMarkBytes) {
      this.highWater = true
    }
    return this.highWater
  }

  get isHighWater(): boolean {
    return this.highWater
  }

  reset(): void {
    this.highWater = false
  }
}
