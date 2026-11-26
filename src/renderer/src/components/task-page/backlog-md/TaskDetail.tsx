import { ArrowLeft, Play } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import CommentMarkdown from '@/components/comment-markdown/CommentMarkdown'
import type { BacklogMdTaskRow } from './backlog-md-task-view'

export function TaskPageBacklogMdTaskDetail({
  row,
  onBack,
  onStart
}: {
  row: BacklogMdTaskRow
  onBack: () => void
  onStart: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { task } = row
  const facts: [string, string][] = [
    [t('auto.components.TaskPage.backlogMdStatus', 'Status'), task.status],
    [t('auto.components.TaskPage.backlogMdAssignee', 'Assignee'), task.assignees.join(', ')],
    [t('auto.components.TaskPage.backlogMdLabels', 'Labels'), task.labels.join(', ')],
    [t('auto.components.TaskPage.backlogMdPriority', 'Priority'), task.priority ?? ''],
    [t('auto.components.TaskPage.backlogMdMilestone', 'Milestone'), task.milestone ?? ''],
    [
      t('auto.components.TaskPage.backlogMdDependencies', 'Depends on'),
      task.dependencies.join(', ')
    ],
    [t('auto.components.TaskPage.backlogMdParent', 'Parent'), task.parentTaskId ?? ''],
    [
      t('auto.components.TaskPage.backlogMdUpdated', 'Updated'),
      task.updatedDate ?? task.createdDate ?? ''
    ]
  ]
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/50 bg-background">
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          {t('auto.components.TaskPage.backlogMdBack', 'Backlog.md tasks')}
        </Button>
        <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
        <span className="text-xs text-muted-foreground">
          {`${row.repo.displayName} · ${row.folder}/tasks/${task.fileName}`}
        </span>
        <Button size="sm" onClick={onStart} className="ml-auto">
          <Play className="size-3.5" />
          {t('auto.components.TaskPage.backlogMdStart', 'Start workspace')}
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <h2 className="text-lg font-semibold text-foreground">{task.title}</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {facts
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words text-foreground">{value}</dd>
              </div>
            ))}
        </dl>
        {task.body ? (
          <CommentMarkdown content={task.body} variant="document" className="mt-4" />
        ) : null}
      </div>
    </div>
  )
}
