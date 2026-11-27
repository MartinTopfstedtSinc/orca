export const CHE_PORT_EXPOSURE_MODES = ['auto', 'path', 'slots', 'off'] as const
/** `auto` uses subdomain slots when the workspace declares them, else the path route. */
export type ChePortExposureMode = (typeof CHE_PORT_EXPOSURE_MODES)[number]

export type WorkspacePortPublicUrlMode = 'che-path' | 'che-slot'

export type WorkspacePortPublicUrl = {
  url: string
  mode: WorkspacePortPublicUrlMode
  /** Slot mode: the port that lost its slot to this one. */
  evictedPort?: number
}

export type ChePortExposureSettings = {
  /** How an Eclipse Che server publishes workspace ports to browsers; ignored outside Che. */
  chePortExposure?: ChePortExposureMode
}
