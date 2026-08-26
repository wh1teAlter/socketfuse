# 接口: WwsDiagnosticEvent

定义于: [core/src/shared/types.ts:264](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L264)

传给可选 logger 的已脱敏运行事件。

## 属性

### type

> `readonly` **type**: `string`

定义于: [core/src/shared/types.ts:266](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L266)

诊断事件类别。

***

### timestamp

> `readonly` **timestamp**: `number`

定义于: [core/src/shared/types.ts:268](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L268)

产生事件的 Unix 时间戳，单位为毫秒。

***

### code?

> `readonly` `optional` **code?**: `string`

定义于: [core/src/shared/types.ts:270](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L270)

可公开的稳定错误或原因码。

***

### details?

> `readonly` `optional` **details?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

定义于: [core/src/shared/types.ts:272](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L272)

只含原始值白名单的附加信息；不含凭据与 payload。
