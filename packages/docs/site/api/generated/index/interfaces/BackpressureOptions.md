# 接口: BackpressureOptions

定义于: [core/src/shared/types.ts:88](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L88)

共享 WebSocket 的 `bufferedAmount` 背压阈值，单位为字节。

## 属性

### highWaterMarkBytes

> **highWaterMarkBytes**: `number`

定义于: [core/src/shared/types.ts:90](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L90)

达到此值后拒绝或按队列策略处理新发送。

***

### lowWaterMarkBytes

> **lowWaterMarkBytes**: `number`

定义于: [core/src/shared/types.ts:92](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L92)

下降到此值后恢复队列冲刷；必须小于高水位。
