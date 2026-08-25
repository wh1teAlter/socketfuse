# 类型别名: ProtocolFrame\<Data\>

> **ProtocolFrame**\<`Data`\> = \{ `type`: `"data"`; `data`: `Data`; \} \| \{ `type`: `"ready"`; \} \| \{ `type`: `"ping"`; `data`: `Data`; \} \| \{ `type`: `"pong"`; \} \| \{ `type`: `"ignore"`; \} \| \{ `type`: `"fatal"`; `code?`: `string`; \}

定义于: [core/src/shared/types.ts:407](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L407)

将业务数据与协议控制帧分开的分类结果。

## 类型参数

### Data

`Data`

## 联合成员

### 类型字面量

\{ `type`: `"data"`; `data`: `Data`; \}

#### type

> `readonly` **type**: `"data"`

应派发给业务 handler 的数据帧。

#### data

> `readonly` **data**: `Data`

解码后的业务值。

***

### 类型字面量

\{ `type`: `"ready"`; \}

#### type

> `readonly` **type**: `"ready"`

表示协议握手已完成。

***

### 类型字面量

\{ `type`: `"ping"`; `data`: `Data`; \}

#### type

> `readonly` **type**: `"ping"`

服务端 ping 控制帧。

#### data

> `readonly` **data**: `Data`

解码后的 ping 数据。

***

### 类型字面量

\{ `type`: `"pong"`; \}

#### type

> `readonly` **type**: `"pong"`

客户端已收到 pong。

***

### 类型字面量

\{ `type`: `"ignore"`; \}

#### type

> `readonly` **type**: `"ignore"`

已消费但不应派发的协议帧。

***

### 类型字面量

\{ `type`: `"fatal"`; `code?`: `string`; \}

#### type

> `readonly` **type**: `"fatal"`

不可恢复的协议错误。

#### code?

> `readonly` `optional` **code?**: `string`

可选稳定原因码，不含原始异常文本。
