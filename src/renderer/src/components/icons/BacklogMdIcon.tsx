import { SquareKanban } from 'lucide-react'

// Backlog.md ships no brand mark; a kanban square reads as a Markdown task board.
export function BacklogMdIcon({ className }: { className?: string }): React.JSX.Element {
  return <SquareKanban className={className} />
}
