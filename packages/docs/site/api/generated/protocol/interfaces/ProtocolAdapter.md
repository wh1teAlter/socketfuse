# 接口: ProtocolAdapter\<Incoming, Outgoing, Auth\>

定义于: [core/src/shared/types.ts:453](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L453)

定义一个应用协议的编码与控制帧语义。

适配器函数只能在 custom Worker 内执行，不能跨 `MessagePort`。`id`、`version`、
capabilities、ready 语义与 `sharedConfig` 共同构成共享连接身份；相同 `id` 的
不同身份必须被拒绝，不能静默复用。

## 类型参数

### Incoming

`Incoming`

解码后派发给页面监听器的业务 payload。

### Outgoing

`Outgoing`

`sendMessage` 接受的业务值。

### Auth

`Auth` = `unknown`

`updateAuth` 接受的带 revision 认证值。

## 属性

### id

> `readonly` **id**: `string`

定义于: [core/src/shared/types.ts:455](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L455)

在 Worker 注册表中查找适配器的稳定 id。

***

### version

> `readonly` **version**: `number`

定义于: [core/src/shared/types.ts:457](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L457)

参与共享配置冲突检测的正整数版本。

***

### capabilities

> `readonly` **capabilities**: [`ProtocolCapabilities`](../../index/interfaces/ProtocolCapabilities.md)

定义于: [core/src/shared/types.ts:459](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L459)

声明可用的 auth、heartbeat 与 binary 能力。

***

### sharedConfig?

> `readonly` `optional` **sharedConfig?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

定义于: [core/src/shared/types.ts:461](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L461)

参与共享身份的可结构化克隆静态配置；不得含页面秘密。

***

### readyWhen?

> `readonly` `optional` **readyWhen?**: `"socket-open"` \| `"adapter-frame"`

定义于: [core/src/shared/types.ts:463](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L463)

socket open 即 ready，或必须等待 adapter 分类出的 ready 帧。

***

### encode

> **encode**: (`data`, `context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<[`SocketData`](../../index/type-aliases/SocketData.md)\>

定义于: [core/src/shared/types.ts:465](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L465)

编码一次 `sendMessage`；失败会以 `ENCODE_FAILED` 拒绝调用。

#### 参数

##### data

`Outgoing`

##### context

[`EncodeContext`](EncodeContext.md)

#### 返回

[`MaybePromise`](../type-aliases/MaybePromise.md)\<[`SocketData`](../../index/type-aliases/SocketData.md)\>

***

### decode

> **decode**: (`data`, `context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`Incoming`\>

定义于: [core/src/shared/types.ts:467](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L467)

解码一个原始 socket payload；失败会以 `DECODE_FAILED` 处理。

#### 参数

##### data

[`SocketData`](../../index/type-aliases/SocketData.md)

##### context

[`DecodeContext`](DecodeContext.md)

#### 返回

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`Incoming`\>

***

### classify

> **classify**: (`data`, `context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<[`ProtocolFrame`](../type-aliases/ProtocolFrame.md)\<`Incoming`\>\>

定义于: [core/src/shared/types.ts:469](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L469)

将已解码 payload 分类为业务帧或协议控制帧。

#### 参数

##### data

`Incoming`

##### context

[`ClassifyContext`](ClassifyContext.md)

#### 返回

[`MaybePromise`](../type-aliases/MaybePromise.md)\<[`ProtocolFrame`](../type-aliases/ProtocolFrame.md)\<`Incoming`\>\>

***

### createAuth?

> `optional` **createAuth?**: (`auth`, `context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing` \| readonly `Outgoing`[]\>

定义于: [core/src/shared/types.ts:471](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L471)

在 open 前根据最新 auth revision 生成认证帧；缺失时不支持 auth 更新。

#### 参数

##### auth

`Auth`

##### context

[`AuthContext`](AuthContext.md)

#### 返回

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing` \| readonly `Outgoing`[]\>

***

### createPing?

> `optional` **createPing?**: (`context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing`\>

定义于: [core/src/shared/types.ts:473](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L473)

生成主动心跳帧；缺失时不支持 WWS heartbeat。

#### 参数

##### context

[`HeartbeatContext`](HeartbeatContext.md)

#### 返回

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing`\>

***

### createPong?

> `optional` **createPong?**: (`ping`, `context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing`\>

定义于: [core/src/shared/types.ts:475](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L475)

对分类出的服务端 ping 生成响应；缺失时不自动回复。

#### 参数

##### ping

[`ProtocolFrame`](../type-aliases/ProtocolFrame.md)\<`Incoming`\>

##### context

[`HeartbeatContext`](HeartbeatContext.md)

#### 返回

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing`\>

***

### shouldReconnect?

> `optional` **shouldReconnect?**: (`close`) => `boolean`

定义于: [core/src/shared/types.ts:477](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L477)

根据已脱敏 close 信息决定是否允许重连；缺失时使用默认策略。

#### 参数

##### close

[`SafeCloseInfo`](SafeCloseInfo.md)

#### 返回

`boolean`
