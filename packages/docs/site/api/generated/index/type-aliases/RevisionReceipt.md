# 类型别名: RevisionReceipt

> **RevisionReceipt** = \{ `status`: `"applied"`; `revision`: `number`; \} \| \{ `status`: `"stale"`; `revision`: `number`; \} \| \{ `status`: `"unchanged"`; `revision`: `number`; \}

定义于: [core/src/shared/types.ts:177](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L177)

单调 endpoint/auth revision 更新的结果。

## 联合成员

### 类型字面量

\{ `status`: `"applied"`; `revision`: `number`; \}

#### status

> `readonly` **status**: `"applied"`

新 revision 已应用。

#### revision

> `readonly` **revision**: `number`

生效的正安全整数 revision。

***

### 类型字面量

\{ `status`: `"stale"`; `revision`: `number`; \}

#### status

> `readonly` **status**: `"stale"`

revision 早于当前值，状态未改变。

#### revision

> `readonly` **revision**: `number`

当前已知 revision。

***

### 类型字面量

\{ `status`: `"unchanged"`; `revision`: `number`; \}

#### status

> `readonly` **status**: `"unchanged"`

revision 与当前值相同，状态未改变。

#### revision

> `readonly` **revision**: `number`

已存在的 revision。
