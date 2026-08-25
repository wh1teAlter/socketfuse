# 接口: WwsOverflowEvent

定义于: [core/src/shared/types.ts:252](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L252)

出站队列、入站 credit 或回放缓冲触及边界时的通知。

## 继承

- `Event`

## 属性

### direction

> `readonly` **direction**: `"outbound"` \| `"inbound"` \| `"replay"`

定义于: [core/src/shared/types.ts:254](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L254)

发生溢出的数据方向。

***

### strategy

> `readonly` **strategy**: `"reject-newest"` \| `"drop-newest"` \| `"drop-oldest"`

定义于: [core/src/shared/types.ts:256](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L256)

为保持有界内存所采用的丢弃策略。

***

### droppedMessages

> `readonly` **droppedMessages**: `number`

定义于: [core/src/shared/types.ts:258](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L258)

本次通知累计丢弃的消息数。

***

### droppedBytes

> `readonly` **droppedBytes**: `number`

定义于: [core/src/shared/types.ts:260](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L260)

本次通知累计丢弃的字节数。
