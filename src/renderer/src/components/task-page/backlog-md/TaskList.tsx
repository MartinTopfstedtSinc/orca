import { Play } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import type { BacklogMdTaskRow } from './backlog-md-task-view'

export function TaskPageBacklogMdTaskList({
  rows,
  showProject,
  onOpen,
  onStart
}: {
  rows: readonly BacklogMdTaskRow[]
  showProject: boolean
  onOpen: (row: BacklogMdTaskRow) => void
  onStart: (row: BacklogMdTaskRow) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <ul className="scrollbar-sleek min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto rounded-md rounded-t-none border border-t-0 border-border/50 bg-background">
      {rows.map((row) => {
        const { task } = row
        const criteria = task.acceptanceCriteria
        return (
          <li key={row.key} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40">
            <button
              type="button"
              onClick={() => onOpen(row)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="w-20 flex-none truncate font-mono text-xs text-muted-foreground">
                {task.id}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{task.title}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {showProject ? <span className="truncate">{row.repo.displayName}</span> : null}
                  {task.assignees.length > 0 ? (
                    <span className="truncate">{task.assignees.join(', ')}</span>
                  ) : null}
                  {task.labels.map((label) => (
                    <span key={label} className="rounded border border-border/50 px-1">
                      {label}
                    </span>
                  ))}
                </span>
              </span>
              {criteria.total > 0 ? (
                <span
                  className="hidden flex-none text-xs tabular-nums text-muted-foreground sm:inline"
                  title={t(
                    'auto.components.TaskPage.backlogMdCriteriaTitle',
                    'Acceptance criteria done'
                  )}
                >
                  {criteria.checked}/{criteria.total}
                </span>
              ) : null}
              <span className="w-24 flex-none truncate text-right text-xs text-muted-foreground">
                {task.status}
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onStart(row)}
              aria-label={t('auto.components.TaskPage.backlogMdStart', 'Start workspace')}
              title={t('auto.components.TaskPage.backlogMdStart', 'Start workspace')}
              className="flex-none"
            >
              <Play className="size-3.5" />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
