# 接口: SharedWebSocketRuntimeOptions

定义于: [core/src/worker/runtime.ts:36](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/worker/runtime.ts#L36)

自定义 Worker runtime 的依赖、时钟与静态协议注册。

## 属性

### protocols?

> `readonly` `optional` **protocols?**: readonly [`ProtocolAdapter`](../../protocol/interfaces/ProtocolAdapter.md)\<`unknown`, `unknown`, `unknown`\>[]

定义于: [core/src/worker/runtime.ts:38](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/worker/runtime.ts#L38)

在 Worker 内静态注册的 custom adapter。

***

### socketFactory?

> `readonly` `optional` **socketFactory?**: `WebSocketFactory`

定义于: [core/src/worker/runtime.ts:40](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/worker/runtime.ts#L40)

可注入的 WebSocket 工厂。

***

### now?

> `readonly` `optional` **now?**: () => `number`

定义于: [core/src/worker/runtime.ts:42](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/worker/runtime.ts#L42)

当前时间源，单位为 Unix 毫秒。

#### 返回

`number`

***

### setTimeout?

> `readonly` `optional` **setTimeout?**: (`callback`, `delay`) => `number`

定义于: [core/src/worker/runtime.ts:44](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/worker/runtime.ts#L44)

可注入的 timer 工厂。

#### 参数

##### callback

() => `void`

##### delay

`number`

#### 返回

`number`

***

### clearTimeout?

> `readonly` `optional` **clearTimeout?**: (`handle`) => `void`

定义于: [core/src/worker/runtime.ts:46](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/worker/runtime.ts#L46)

与注入 timer 配对的清理函数。

#### 参数

##### handle

`number`

#### 返回

`void`

***

### workerLimits?

> `readonly` `optional` **workerLimits?**: `Partial`\<[`WorkerResourceLimits`](WorkerResourceLimits.md)\>

定义于: [core/src/worker/runtime.ts:48](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/worker/runtime.ts#L48)

runtime 静态资源上限，只能在首个页面连接前设置。
