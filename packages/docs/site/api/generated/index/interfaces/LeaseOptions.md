# 接口: LeaseOptions

定义于: [core/src/shared/types.ts:96](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L96)

共享页面 client 的活性租约；时间字段单位均为毫秒。

## 属性

### interval

> **interval**: `number`

定义于: [core/src/shared/types.ts:98](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L98)

页面向 Worker 报活的间隔。

***

### timeout

> **timeout**: `number`

定义于: [core/src/shared/types.ts:100](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L100)

Worker 判定异常页面已失活并回收端口的时限。
