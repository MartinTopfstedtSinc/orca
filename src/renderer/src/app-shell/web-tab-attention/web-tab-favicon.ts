import appIconUrl from '../../../../../resources/icon.png?url'

const SIZE = 64
// The renderer's count-badge color (RightSidebarToggle's needs-you badge); orange-600 if the token can't be read.
const FALLBACK_BADGE_COLOR = '#ea580c'

let iconLoad: Promise<HTMLImageElement | null> | null = null

function loadAppIcon(): Promise<HTMLImageElement | null> {
  iconLoad ??= new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = appIconUrl
  })
  return iconLoad
}

function faviconLink(): HTMLLinkElement {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (existing) {
    return existing
  }
  const link = document.createElement('link')
  link.rel = 'icon'
  document.head.append(link)
  return link
}

function badgeColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--agent-question')
  return value.trim() || FALLBACK_BADGE_COLOR
}

/** The tab title with the count in front, as mail and chat tabs show theirs. */
export function webTabAttentionTitle(baseTitle: string, count: number): string {
  return count > 0 ? `(${count}) ${baseTitle}` : baseTitle
}

function drawBadgedIcon(icon: HTMLImageElement | null, count: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  if (icon) {
    context.drawImage(icon, 0, 0, SIZE, SIZE)
  }
  const radius = SIZE * 0.3
  const centerX = SIZE - radius
  const centerY = radius
  context.beginPath()
  context.arc(centerX, centerY, radius, 0, Math.PI * 2)
  context.fillStyle = badgeColor()
  context.fill()
  // A white ring keeps the badge apart from the icon on any tab-strip theme.
  context.lineWidth = SIZE * 0.05
  context.strokeStyle = '#fff'
  context.stroke()
  context.fillStyle = '#fff'
  context.font = `bold ${Math.round(radius * (count > 9 ? 1.05 : 1.4))}px system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(count > 9 ? '9+' : String(count), centerX, centerY + radius * 0.08)
  return canvas.toDataURL('image/png')
}

/** Shows the app icon as the tab's favicon, badged with `count` while it is above zero. */
export async function applyWebTabFavicon(count: number, isCurrent: () => boolean): Promise<void> {
  if (count <= 0) {
    faviconLink().href = appIconUrl
    return
  }
  const icon = await loadAppIcon()
  // A later count may have landed while the icon loaded.
  if (!isCurrent()) {
    return
  }
  faviconLink().href = drawBadgedIcon(icon, count) ?? appIconUrl
}
