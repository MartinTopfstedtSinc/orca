import type { Repo } from '../../../../../shared/repository/repo-types'
import type { BacklogMdTask } from '../../../../../shared/backlog-md/backlog-md-task'
import { slugifyForWorkspaceName } from '../../../../../shared/workspace/naming/workspace-name'
import type { BacklogMdRepoTasks } from './backlog-md-task-loader'

export type BacklogMdTaskRow = { key: string; repo: Repo; folder: string; task: BacklogMdTask }

export type BacklogMdTaskFilters = {
  status: string | null
  label: string | null
  assignee: string | null
  query: string
}

export function collectBacklogMdRows(results: readonly BacklogMdRepoTasks[]): {
  rows: BacklogMdTaskRow[]
  statuses: string[]
  labels: string[]
  assignees: string[]
} {
  const rows: BacklogMdTaskRow[] = []
  const statuses: string[] = []
  for (const result of results) {
    if (result.status !== 'ready') {
      continue
    }
    for (const status of result.config.statuses) {
      if (!statuses.includes(status)) {
        statuses.push(status)
      }
    }
    const order = result.config.statuses
    const tasks = [...result.tasks].sort((a, b) => compareTasks(a, b, order))
    for (const task of tasks) {
      rows.push({
        key: `${result.repo.id}:${task.fileName}`,
        repo: result.repo,
        folder: result.folder,
        task
      })
      if (task.status && !statuses.includes(task.status)) {
        statuses.push(task.status)
      }
    }
  }
  return {
    rows,
    statuses,
    labels: uniqueSorted(rows.flatMap((row) => row.task.labels)),
    assignees: uniqueSorted(rows.flatMap((row) => row.task.assignees))
  }
}

export function filterBacklogMdRows(
  rows: readonly BacklogMdTaskRow[],
  filters: BacklogMdTaskFilters
): BacklogMdTaskRow[] {
  const query = filters.query.trim().toLowerCase()
  return rows.filter(({ task }) => {
    if (filters.status !== null && task.status !== filters.status) {
      return false
    }
    if (filters.label !== null && !task.labels.includes(filters.label)) {
      return false
    }
    if (filters.assignee !== null && !task.assignees.includes(filters.assignee)) {
      return false
    }
    return (
      !query ||
      task.id.toLowerCase().includes(query) ||
      task.title.toLowerCase().includes(query) ||
      task.labels.some((label) => label.toLowerCase().includes(query))
    )
  })
}

export function backlogMdWorkspaceSeed(task: BacklogMdTask): string {
  return slugifyForWorkspaceName(`${task.id} ${task.title}`)
}

export function backlogMdTaskFilePath(row: BacklogMdTaskRow): string {
  return `${row.folder}/tasks/${row.task.fileName}`
}

/** The agent reads the task from the repo, so the note points at it instead of copying it. */
export function backlogMdWorkspaceNote(row: BacklogMdTaskRow): string {
  return [
    `Work on Backlog.md task ${row.task.id}: ${row.task.title}`,
    `The task file is ${backlogMdTaskFilePath(row)}. Read it, including its acceptance criteria, before you start.`
  ].join('\n\n')
}

// Board order: configured status order, then the numeric part of the id (task-2 before task-10).
function compareTasks(a: BacklogMdTask, b: BacklogMdTask, statusOrder: readonly string[]): number {
  const rank = (status: string): number => {
    const index = statusOrder.indexOf(status)
    return index === -1 ? statusOrder.length : index
  }
  return (
    rank(a.status) - rank(b.status) ||
    a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
  )
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}
