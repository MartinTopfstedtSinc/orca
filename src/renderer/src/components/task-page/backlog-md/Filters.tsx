import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import TaskProjectSourceCombobox from '@/components/task-page/source-selection/task-project-source-combobox'
import { normalizeTaskRepoSelection } from '../../../../../shared/work-items/task-repo-selection'
import type { BacklogMdTaskFilters } from './backlog-md-task-view'

const ALL = '__all__'

export function TaskPageBacklogMdFilters({
  model,
  filters,
  onFiltersChange,
  statuses,
  labels,
  assignees,
  loading,
  onRefresh
}: {
  model: TaskPageComposerActionsModel
  filters: BacklogMdTaskFilters
  onFiltersChange: (next: BacklogMdTaskFilters) => void
  statuses: readonly string[]
  labels: readonly string[]
  assignees: readonly string[]
  loading: boolean
  onRefresh: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const {
    updateSettings,
    eligibleRepos,
    repoSelection,
    setRepoSelection,
    taskPickerGroups,
    taskPickerRepos,
    getTaskPickerRepoHostLabel
  } = model
  const saveSelection = (value: string[] | null): void => {
    void updateSettings({ defaultRepoSelection: value }).catch(() => {
      toast.error(t('auto.components.TaskPage.dfd72673e7', 'Failed to save project selection.'))
    })
  }
  const refreshLabel = t('auto.components.TaskPage.backlogMdRefresh', 'Reload Backlog.md tasks')
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="min-w-0 w-full sm:w-[200px]">
          <TaskProjectSourceCombobox
            groups={taskPickerGroups}
            selected={repoSelection}
            getRepoHostLabel={getTaskPickerRepoHostLabel}
            onChange={(next) => {
              const normalized = normalizeTaskRepoSelection(eligibleRepos, next)
              setRepoSelection(normalized)
              saveSelection([...normalized])
            }}
            onSelectAll={() => {
              setRepoSelection(new Set(taskPickerRepos.map((repo) => repo.id)))
              saveSelection(null)
            }}
            triggerClassName="h-8 w-full"
          />
        </div>
        <Input
          value={filters.query}
          onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
          placeholder={t('auto.components.TaskPage.backlogMdSearch', 'Search id, title or label')}
          aria-label={t('auto.components.TaskPage.backlogMdSearch', 'Search id, title or label')}
          className="h-8 w-full sm:w-[220px]"
        />
        <FilterSelect
          value={filters.label}
          options={labels}
          allLabel={t('auto.components.TaskPage.backlogMdAllLabels', 'All labels')}
          onChange={(label) => onFiltersChange({ ...filters, label })}
        />
        <FilterSelect
          value={filters.assignee}
          options={assignees}
          allLabel={t('auto.components.TaskPage.backlogMdAllAssignees', 'All assignees')}
          onChange={(assignee) => onFiltersChange({ ...filters, assignee })}
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 py-2 shadow-sm">
        <div className="flex min-w-0 flex-wrap gap-2">
          <FilterChip
            label={t('auto.components.TaskPage.c2268a9982', 'All')}
            active={filters.status === null}
            onSelect={() => onFiltersChange({ ...filters, status: null })}
          />
          {statuses.map((status) => (
            <FilterChip
              key={status}
              label={status}
              active={filters.status === status}
              onSelect={() => onFiltersChange({ ...filters, status })}
            />
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              onClick={onRefresh}
              disabled={loading}
              aria-label={refreshLabel}
            >
              {loading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {refreshLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function FilterSelect({
  value,
  options,
  allLabel,
  onChange
}: {
  value: string | null
  options: readonly string[]
  allLabel: string
  onChange: (value: string | null) => void
}): React.JSX.Element | null {
  if (options.length === 0) {
    return null
  }
  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
      <SelectTrigger className="h-8 w-full sm:w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function FilterChip({
  label,
  active,
  onSelect
}: {
  label: string
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'rounded-md border px-2 py-1 text-xs transition',
        active
          ? 'border-border/50 bg-foreground/90 text-background backdrop-blur-md'
          : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
      )}
    >
      {label}
    </button>
  )
}
