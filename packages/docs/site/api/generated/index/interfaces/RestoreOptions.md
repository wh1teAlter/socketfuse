# 接口: RestoreOptions

定义于: [core/src/shared/types.ts:122](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L122)

页面启用生命周期恢复后，在挂起期间使用的本地回放缓冲配置。

## 属性

### replay?

> `optional` **replay?**: `boolean`

定义于: [core/src/shared/types.ts:124](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L124)

恢复时是否通过 `onMessage` 重放缓冲消息，默认值为 `false`。

***

### maxMessages?

> `optional` **maxMessages?**: `number`

定义于: [core/src/shared/types.ts:126](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L126)

可缓冲的最大消息数，默认值为 `256`。

***

### maxBytes?

> `optional` **maxBytes?**: `number`

定义于: [core/src/shared/types.ts:128](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L128)

可缓冲的最大 payload 字节数，默认值为 4 MiB。
