# 接口: SafeCloseInfo

定义于: [core/src/shared/types.ts:397](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L397)

提供给适配器重连决策的已脱敏 close 信息。

## 属性

### code

> `readonly` **code**: `number`

定义于: [core/src/shared/types.ts:399](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L399)

原生 WebSocket close code。

***

### wasClean

> `readonly` **wasClean**: `boolean`

定义于: [core/src/shared/types.ts:401](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L401)

close 是否为 clean。

***

### terminal

> `readonly` **terminal**: `boolean`

定义于: [core/src/shared/types.ts:403](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L403)

WWS 是否已判定当前连接进入终态。
