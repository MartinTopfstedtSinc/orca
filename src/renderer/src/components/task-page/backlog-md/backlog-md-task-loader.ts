import type { Repo } from '../../../../../shared/repository/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import {
  BACKLOG_MD_CONFIG_FILE_NAMES,
  BACKLOG_MD_DEFAULT_STATUSES,
  BACKLOG_MD_FOLDER_NAMES,
  BACKLOG_MD_TASKS_FOLDER,
  isBacklogMdTaskFileName,
  parseBacklogMdConfig,
  parseBacklogMdTask,
  type BacklogMdConfig,
  type BacklogMdTask
} from '../../../../../shared/backlog-md/backlog-md-task'
import { joinPath } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import { readRuntimeDirectory } from '@/runtime/files/reads/runtime-directory-read'
import { readRuntimeFileContent } from '@/runtime/files/reads/runtime-file-read-client'
import { runtimePathExists } from '@/runtime/files/metadata/runtime-file-metadata-client'
import type { RuntimeFileOperationArgs } from '@/runtime/files/runtime-file-client-types'
import { buildWorkspaceFileContext } from '@/runtime/files/workspace-file-host-routing'

const MAX_TASK_FILES = 1000
const READ_CONCURRENCY = 8

export type BacklogMdRepoTasks =
  | { status: 'ready'; repo: Repo; folder: string; config: BacklogMdConfig; tasks: BacklogMdTask[] }
  | { status: 'no-backlog'; repo: Repo }
  | { status: 'error'; repo: Repo; message: string }

/** Reads the repo's default checkout, the same working copy the backlog CLI reads. */
export async function loadBacklogMdRepoTasks(
  repo: Repo,
  worktrees: readonly Worktree[]
): Promise<BacklogMdRepoTasks> {
  const checkout = worktrees.find(
    (worktree) => worktree.repoId === repo.id && worktree.isMainWorktree
  )
  if (!checkout) {
    return {
      status: 'error',
      repo,
      message: translate(
        'auto.components.TaskPage.backlogMdNoCheckout',
        'This project has no checkout to read.'
      )
    }
  }
  try {
    const context = buildWorkspaceFileContext(checkout.id, checkout.path)
    const folder = await findBacklogFolder(context, checkout.path)
    if (!folder) {
      return { status: 'no-backlog', repo }
    }
    const [config, tasks] = await Promise.all([
      readConfig(context, checkout, folder),
      readTasks(context, checkout, folder)
    ])
    return { status: 'ready', repo, folder, config, tasks }
  } catch (error) {
    return {
      status: 'error',
      repo,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function findBacklogFolder(
  context: RuntimeFileOperationArgs,
  root: string
): Promise<string | null> {
  for (const folder of BACKLOG_MD_FOLDER_NAMES) {
    if (await runtimePathExists(context, joinPath(root, `${folder}/${BACKLOG_MD_TASKS_FOLDER}`))) {
      return folder
    }
  }
  return null
}

async function readConfig(
  context: RuntimeFileOperationArgs,
  checkout: Worktree,
  folder: string
): Promise<BacklogMdConfig> {
  for (const name of BACKLOG_MD_CONFIG_FILE_NAMES) {
    const relativePath = `${folder}/${name}`
    if (!(await runtimePathExists(context, joinPath(checkout.path, relativePath)))) {
      continue
    }
    const content = await readText(context, checkout, relativePath)
    if (content !== null) {
      return parseBacklogMdConfig(content)
    }
  }
  return { projectName: null, statuses: [...BACKLOG_MD_DEFAULT_STATUSES], defaultStatus: null }
}

async function readTasks(
  context: RuntimeFileOperationArgs,
  checkout: Worktree,
  folder: string
): Promise<BacklogMdTask[]> {
  const tasksFolder = `${folder}/${BACKLOG_MD_TASKS_FOLDER}`
  const entries = await readRuntimeDirectory(context, joinPath(checkout.path, tasksFolder))
  const names = entries
    .filter(
      (entry) => !entry.isDirectory && !entry.isSymlink && isBacklogMdTaskFileName(entry.name)
    )
    .map((entry) => entry.name)
    .slice(0, MAX_TASK_FILES)
  const tasks: BacklogMdTask[] = []
  let next = 0
  // Bounded fan-out: a remote host answers each read over one connection.
  const workers = Array.from({ length: Math.min(READ_CONCURRENCY, names.length) }, async () => {
    while (next < names.length) {
      const name = names[next++]
      const content = await readText(context, checkout, `${tasksFolder}/${name}`).catch(() => null)
      const task = content === null ? null : parseBacklogMdTask(content, name)
      if (task) {
        tasks.push(task)
      }
    }
  })
  await Promise.all(workers)
  return tasks
}

async function readText(
  context: RuntimeFileOperationArgs,
  checkout: Worktree,
  relativePath: string
): Promise<string | null> {
  const result = await readRuntimeFileContent({
    target: context.target,
    filePath: joinPath(checkout.path, relativePath),
    relativePath,
    worktreeId: checkout.id,
    connectionId: context.connectionId
  })
  return result.isBinary ? null : result.content
}
