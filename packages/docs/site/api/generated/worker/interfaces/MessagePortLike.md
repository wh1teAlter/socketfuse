# 接口: MessagePortLike

定义于: [core/src/worker/runtime.ts:18](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/worker/runtime.ts#L18)

自定义 Worker runtime 使用的最小 MessagePort 能力面。

## 属性

### postMessage

> **postMessage**: (`message`) => `void`

定义于: [core/src/worker/runtime.ts:20](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/worker/runtime.ts#L20)

发送结构化克隆控制消息。

#### 参数

##### message

`unknown`

#### 返回

`void`

***

### start?

> `optional` **start?**: () => `void`

定义于: [core/src/worker/runtime.ts:22](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/worker/runtime.ts#L22)

开始接收事件。

#### 返回

`void`

***

### close?

> `optional` **close?**: () => `void`

定义于: [core/src/worker/runtime.ts:24](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/worker/runtime.ts#L24)

关闭端口并释放其消息通道。

#### 返回

`void`

***

### addEventListener?

> `optional` **addEventListener?**: (`type`, `listener`) => `void`

定义于: [core/src/worker/runtime.ts:26](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/worker/runtime.ts#L26)

注册消息或消息解析错误监听。

#### 参数

##### type

`"message"` \| `"messageerror"`

##### listener

(`event`) => `void`

#### 返回

`void`

***

### removeEventListener?

> `optional` **removeEventListener?**: (`type`, `listener`) => `void`

定义于: [core/src/worker/runtime.ts:28](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/worker/runtime.ts#L28)

移除已注册监听。

#### 参数

##### type

`"message"` \| `"messageerror"`

##### listener

(`event`) => `void`

#### 返回

`void`

***

### onmessage?

> `optional` **onmessage?**: ((`event`) => `void`) \| `null`

定义于: [core/src/worker/runtime.ts:30](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/worker/runtime.ts#L30)

不支持 addEventListener 时的消息回调。

***

### onmessageerror?

> `optional` **onmessageerror?**: ((`event`) => `void`) \| `null`

定义于: [core/src/worker/runtime.ts:32](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/worker/runtime.ts#L32)

不支持 addEventListener 时的消息错误回调。
