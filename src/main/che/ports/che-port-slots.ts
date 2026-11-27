import type { CheSlotEndpoint } from './che-endpoint-discovery'

export type ChePortSlot = {
  name: string
  targetPort: number
  origin: string
  assignedPort: number | null
  /** Bumps on every reassignment; cookies and tickets name the generation they were minted for. */
  generation: number
  lastUsedAt: number
  /** The first browser after a reassignment drops the previous app's storage and cookies. */
  clearPending: boolean
}

export type ChePortSlotListening = (port: number) => Promise<boolean>

/** Maps localhost ports onto the subdomain endpoints the workspace declares, least recently used first out. */
export class ChePortSlotTable {
  readonly slots: ChePortSlot[]

  constructor(
    endpoints: readonly CheSlotEndpoint[],
    private readonly isListening: ChePortSlotListening,
    private readonly now: () => number = Date.now
  ) {
    this.slots = endpoints.flatMap((endpoint) =>
      endpoint.origin
        ? [
            {
              name: endpoint.name,
              targetPort: endpoint.targetPort,
              origin: endpoint.origin,
              assignedPort: null,
              generation: 0,
              lastUsedAt: 0,
              clearPending: false
            }
          ]
        : []
    )
  }

  get available(): boolean {
    return this.slots.length > 0
  }

  bySlotPort(targetPort: number): ChePortSlot | undefined {
    return this.slots.find((slot) => slot.targetPort === targetPort)
  }

  touch(slot: ChePortSlot): void {
    slot.lastUsedAt = this.now()
  }

  /** The slot already showing `port`, else a free one, else one whose app stopped, else the LRU. */
  async assign(port: number): Promise<{ slot: ChePortSlot; evictedPort: number | null }> {
    const current = this.slots.find((slot) => slot.assignedPort === port)
    if (current) {
      this.touch(current)
      return { slot: current, evictedPort: null }
    }
    let chosen = this.slots.find((slot) => slot.assignedPort === null)
    if (!chosen) {
      const listening = await Promise.all(
        this.slots.map((slot) => this.isListening(slot.assignedPort ?? 0))
      )
      chosen = this.slots.find((_slot, index) => !listening[index])
    }
    chosen ??= this.slots.reduce((oldest, slot) =>
      slot.lastUsedAt < oldest.lastUsedAt ? slot : oldest
    )
    const evictedPort = chosen.assignedPort
    chosen.assignedPort = port
    chosen.generation += 1
    // A slot that never served an app holds nothing worth clearing.
    chosen.clearPending = chosen.generation > 1
    this.touch(chosen)
    return { slot: chosen, evictedPort }
  }
}
