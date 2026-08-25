/** 根据原生 bufferedAmount 的高低水位跟踪出站背压。 */
import type { BackpressureOptions } from '../shared/types'

export class BackpressureTracker {
  /** 当前是否已经跨过高水位；只有降至低水位才解除，形成迟滞。 */
  private highWater = false

  /** 创建使用固定高低水位的背压跟踪器。 */
  constructor(readonly options: Readonly<BackpressureOptions>) {}

  /** 根据原生 bufferedAmount 更新状态并返回当前是否处于高水位。 */
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

  /** 清除高水位状态，通常在物理 socket 更换后调用。 */
  reset(): void {
    this.highWater = false
  }
}
