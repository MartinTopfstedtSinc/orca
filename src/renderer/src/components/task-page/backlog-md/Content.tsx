import { useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'
import { useTranslate } from '@/i18n/use-translate'
import { BacklogMdIcon } from '@/components/icons/BacklogMdIcon'
import { TaskPageBacklogMdFilters } from './Filters'
import { TaskPageBacklogMdTaskList } from './TaskList'
import { TaskPageBacklogMdTaskDetail } from './TaskDetail'
import { useBacklogMdTasks } from './use-backlog-md-tasks'
import {
  backlogMdWorkspaceNote,
  backlogMdWorkspaceSeed,
  collectBacklogMdRows,
  filterBacklogMdRows,
  type BacklogMdTaskFilters,
  type BacklogMdTaskRow
} from './backlog-md-task-view'

const NO_FILTERS: BacklogMdTaskFilters = { status: null, label: null, assignee: null, query: '' }

export function TaskPageBacklogMdContent({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element {
  const t = useTranslate()
  const { selectedRepos, openModal } = model
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [filters, setFilters] = useState<BacklogMdTaskFilters>(NO_FILTERS)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const { loading, results } = useBacklogMdTasks(selectedRepos, refreshNonce)
  const collected = useMemo(() => collectBacklogMdRows(results), [results])
  const rows = useMemo(
    () => filterBacklogMdRows(collected.rows, filters),
    [collected.rows, filters]
  )
  const openRow = collected.rows.find((row) => row.key === openKey) ?? null
  const failures = results.flatMap((result) => (result.status === 'error' ? [result] : []))
  const hasBacklog = results.some((result) => result.status === 'ready')

  const startWorkspace = (row: BacklogMdTaskRow): void => {
    openModal('new-workspace-composer', {
      prefilledName: backlogMdWorkspaceSeed(row.task),
      prefilledNote: backlogMdWorkspaceNote(row),
      initialRepoId: row.repo.id,
      telemetrySource: 'sidebar'
    })
  }

  if (openRow) {
    return (
      <TaskPageBacklogMdTaskDetail
        row={openRow}
        onBack={() => setOpenKey(null)}
        onStart={() => startWorkspace(openRow)}
      />
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskPageBacklogMdFilters
        model={model}
        filters={filters}
        onFiltersChange={setFilters}
        statuses={collected.statuses}
        labels={collected.labels}
        assignees={collected.assignees}
        loading={loading}
        onRefresh={() => setRefreshNonce((nonce) => nonce + 1)}
      />
      {failures.map((failure) => (
        <p key={failure.repo.id} role="status" className="mt-2 text-xs text-destructive">
          {t(
            'auto.components.TaskPage.backlogMdReadFailed',
            'Couldn’t read tasks in {{project}}: {{reason}}',
            {
              project: failure.repo.displayName,
              reason: failure.message
            }
          )}
        </p>
      ))}
      {loading && results.length === 0 ? (
        <div className="flex items-center justify-center py-14">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !hasBacklog ? (
        <div className="flex flex-col items-center justify-center rounded-md rounded-t-none border border-t-0 border-border/50 bg-muted/50 px-6 py-14 text-center">
          <BacklogMdIcon className="mb-4 size-8 text-muted-foreground/60" />
          <p className="text-base font-medium text-foreground">
            {t('auto.components.TaskPage.backlogMdEmptyTitle', 'No Backlog.md tasks here')}
          </p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {t(
              'auto.components.TaskPage.backlogMdEmptyBody',
              'None of the selected projects has a backlog/tasks folder. Run backlog init in a repository to start one.'
            )}
          </p>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md rounded-t-none border border-t-0 border-border/50 px-3 py-10 text-center text-sm text-muted-foreground">
          {t('auto.components.TaskPage.backlogMdNoMatches', 'No tasks match these filters.')}
        </p>
      ) : (
        <TaskPageBacklogMdTaskList
          rows={rows}
          showProject={selectedRepos.length > 1}
          onOpen={(row) => setOpenKey(row.key)}
          onStart={startWorkspace}
        />
      )}
    </div>
  )
}
