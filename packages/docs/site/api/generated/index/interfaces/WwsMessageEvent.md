# 接口: WwsMessageEvent\<Data\>

定义于: [core/src/shared/types.ts:214](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L214)

派发给页面监听器的业务消息；协议控制帧不会出现在这里。

## 继承

- `Event`

## 类型参数

### Data

`Data`

## 属性

### data

> `readonly` **data**: `Data`

定义于: [core/src/shared/types.ts:216](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L216)

协议适配器解码后的应用 payload。

***

### receivedAt

> `readonly` **receivedAt**: `number`

定义于: [core/src/shared/types.ts:218](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L218)

Worker 或 direct transport 接收消息的 Unix 时间戳，单位为毫秒。

***

### transport

> `readonly` **transport**: `"shared-worker"` \| `"direct"`

定义于: [core/src/shared/types.ts:220](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L220)

实际接收消息的已选定传输通道。

***

### replayed

> `readonly` **replayed**: `boolean`

定义于: [core/src/shared/types.ts:222](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L222)

是否由页面生命周期恢复回放，而非实时派发。
