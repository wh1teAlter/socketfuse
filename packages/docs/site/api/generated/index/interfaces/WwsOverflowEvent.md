# Interface: WwsOverflowEvent

Defined in: [core/src/shared/types.ts:178](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L178)

Bounded queue or replay overflow notification.

## Extends

- `Event`

## Properties

### direction

> `readonly` **direction**: `"outbound"` \| `"inbound"` \| `"replay"`

Defined in: [core/src/shared/types.ts:179](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L179)

***

### strategy

> `readonly` **strategy**: `"reject-newest"` \| `"drop-newest"` \| `"drop-oldest"`

Defined in: [core/src/shared/types.ts:180](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L180)

***

### droppedMessages

> `readonly` **droppedMessages**: `number`

Defined in: [core/src/shared/types.ts:181](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L181)

***

### droppedBytes

> `readonly` **droppedBytes**: `number`

Defined in: [core/src/shared/types.ts:182](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L182)
