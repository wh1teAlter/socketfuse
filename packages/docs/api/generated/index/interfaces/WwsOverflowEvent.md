# Interface: WwsOverflowEvent

Defined in: [core/src/types.ts:178](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L178)

Bounded queue or replay overflow notification.

## Extends

- `Event`

## Properties

### direction

> `readonly` **direction**: `"outbound"` \| `"inbound"` \| `"replay"`

Defined in: [core/src/types.ts:179](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L179)

***

### strategy

> `readonly` **strategy**: `"reject-newest"` \| `"drop-newest"` \| `"drop-oldest"`

Defined in: [core/src/types.ts:180](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L180)

***

### droppedMessages

> `readonly` **droppedMessages**: `number`

Defined in: [core/src/types.ts:181](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L181)

***

### droppedBytes

> `readonly` **droppedBytes**: `number`

Defined in: [core/src/types.ts:182](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L182)
