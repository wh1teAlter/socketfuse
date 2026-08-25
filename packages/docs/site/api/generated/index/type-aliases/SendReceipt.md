# 类型别名: SendReceipt

> **SendReceipt** = \{ `status`: `"accepted"`; `messageId`: `string`; `bufferedAmount`: `number`; \} \| \{ `status`: `"queued"`; `messageId`: `string`; `position`: `number`; \}

定义于: [core/src/shared/types.ts:158](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L158)

`sendMessage` 的本地接纳结果；它绝不是服务端投递回执。

## 联合成员

### 类型字面量

\{ `status`: `"accepted"`; `messageId`: `string`; `bufferedAmount`: `number`; \}

#### status

> `readonly` **status**: `"accepted"`

已直接交给原生 socket 的本地接纳结果。

#### messageId

> `readonly` **messageId**: `string`

WWS 本地消息标识。

#### bufferedAmount

> `readonly` **bufferedAmount**: `number`

原生 socket 当前 bufferedAmount，单位为字节。

***

### 类型字面量

\{ `status`: `"queued"`; `messageId`: `string`; `position`: `number`; \}

#### status

> `readonly` **status**: `"queued"`

已进入有界出站队列的本地接纳结果。

#### messageId

> `readonly` **messageId**: `string`

WWS 本地消息标识。

#### position

> `readonly` **position**: `number`

消息在 FIFO 队列中的位置。
