# Interface: WwsOverflowEvent

Defined in: [core/src/types.ts:174](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L174)

Bounded queue or replay overflow notification.

## Extends

- `Event`

## Properties

### direction

> `readonly` **direction**: `"outbound"` \| `"inbound"` \| `"replay"`

Defined in: [core/src/types.ts:175](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L175)

***

### strategy

> `readonly` **strategy**: `"reject-newest"` \| `"drop-newest"` \| `"drop-oldest"`

Defined in: [core/src/types.ts:176](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L176)

***

### droppedMessages

> `readonly` **droppedMessages**: `number`

Defined in: [core/src/types.ts:177](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L177)

***

### droppedBytes

> `readonly` **droppedBytes**: `number`

Defined in: [core/src/types.ts:178](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L178)
