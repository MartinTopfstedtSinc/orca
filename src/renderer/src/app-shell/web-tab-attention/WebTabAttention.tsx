import { useEffect, useState } from 'react'
import { useWebAttentionNotifications } from './use-web-attention-notifications'
import { useWebTabAttentionCount, useWebTabAttentionSources } from './use-web-tab-attention-count'
import { applyWebTabFavicon, webTabAttentionTitle } from './web-tab-favicon'

/** The browser tab's title and favicon count what waits on the owner, so a background tab still says so. */
export default function WebTabAttention(): null {
  const sources = useWebTabAttentionSources()
  const count = useWebTabAttentionCount(sources)
  const [baseTitle] = useState(() => document.title)
  useWebAttentionNotifications(sources)

  useEffect(() => {
    let current = true
    document.title = webTabAttentionTitle(baseTitle, count)
    void applyWebTabFavicon(count, () => current)
    return () => {
      current = false
    }
  }, [baseTitle, count])

  useEffect(() => () => void (document.title = baseTitle), [baseTitle])

  return null
}
