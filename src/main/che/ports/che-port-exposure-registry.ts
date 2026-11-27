import type { WorkspacePortPublicUrl } from '../../../shared/workspace/ports/workspace-port-public-url'

/** What the rest of the runtime needs from Che port exposure, without loading discovery or the proxy. */
export type ChePortPublicUrls = {
  /** In slot mode this assigns a slot and, with `ticket`, mints a one-time sign-in: gestures only. */
  publicUrl(
    port: number,
    path?: string,
    options?: { ticket?: boolean }
  ): Promise<WorkspacePortPublicUrl | null>
  /** `…/__orca/port/`: append `<port>/`. Side-effect free, for scans; null when no path route serves. */
  publicBaseUrl(): string | null
  ptyEnv(): Record<string, string>
}

let active: ChePortPublicUrls | null = null

/** Null outside Che; the runtime then neither advertises nor serves public port URLs. */
export function getChePortPublicUrls(): ChePortPublicUrls | null {
  return active
}

export function setChePortPublicUrls(next: ChePortPublicUrls | null): void {
  active = next
}
