import { isPairedWebClientWindow } from '@/app-shell/chrome/desktop-window-chrome'

// The web client's only recipe is the server-managed Che DevWorkspace, which needs no toggle.
export function ephemeralVmsEnabledFor(
  settings: { experimentalEphemeralVms?: boolean } | null | undefined
): boolean {
  return settings?.experimentalEphemeralVms === true || isPairedWebClientWindow()
}
