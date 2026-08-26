# 接口: BackpressureOptions

定义于: [core/src/shared/types.ts:88](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L88)

共享 WebSocket 的 `bufferedAmount` 背压阈值，单位为字节。

## 属性

### highWaterMarkBytes

> **highWaterMarkBytes**: `number`

定义于: [core/src/shared/types.ts:90](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L90)

达到此值后拒绝或按队列策略处理新发送。

***

### lowWaterMarkBytes

> **lowWaterMarkBytes**: `number`

定义于: [core/src/shared/types.ts:92](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L92)

下降到此值后恢复队列冲刷；必须小于高水位。
