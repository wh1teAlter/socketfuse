# Interface: SharedWebSocketRuntimeOptions

Defined in: [core/src/worker-runtime.ts:23](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L23)

Custom Worker runtime dependencies and statically registered protocols.

## Properties

### protocols?

> `readonly` `optional` **protocols?**: readonly [`ProtocolAdapter`](../../protocol/interfaces/ProtocolAdapter.md)\<`unknown`, `unknown`, `unknown`\>[]

Defined in: [core/src/worker-runtime.ts:24](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L24)

***

### socketFactory?

> `readonly` `optional` **socketFactory?**: `WebSocketFactory`

Defined in: [core/src/worker-runtime.ts:25](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L25)

***

### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [core/src/worker-runtime.ts:26](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L26)

#### Returns

`number`

***

### setTimeout?

> `readonly` `optional` **setTimeout?**: (`callback`, `delay`) => `number`

Defined in: [core/src/worker-runtime.ts:27](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L27)

#### Parameters

##### callback

() => `void`

##### delay

`number`

#### Returns

`number`

***

### clearTimeout?

> `readonly` `optional` **clearTimeout?**: (`handle`) => `void`

Defined in: [core/src/worker-runtime.ts:28](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L28)

#### Parameters

##### handle

`number`

#### Returns

`void`

***

### workerLimits?

> `readonly` `optional` **workerLimits?**: `Partial`\<[`WorkerResourceLimits`](WorkerResourceLimits.md)\>

Defined in: [core/src/worker-runtime.ts:30](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L30)

Static limits for this Worker runtime, set once before any page connects.
