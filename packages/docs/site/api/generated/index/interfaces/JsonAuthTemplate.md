# 接口: JsonAuthTemplate

定义于: [core/src/shared/types.ts:325](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L325)

`$auth` 或 `$auth.` 开头的字符串会在生成认证帧时从 auth 数据替换。

## 属性

### template

> `readonly` **template**: [`JsonValue`](../type-aliases/JsonValue.md)

定义于: [core/src/shared/types.ts:327](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L327)

可含 auth 占位符的认证业务帧模板。
