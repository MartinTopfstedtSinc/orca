import { parse as parseYaml } from 'yaml'

// Backlog.md (github.com/MrLesk/Backlog.md) keeps each task as a Markdown file with YAML frontmatter.
export const BACKLOG_MD_FOLDER_NAMES = ['backlog', '.backlog'] as const
export const BACKLOG_MD_TASKS_FOLDER = 'tasks'
export const BACKLOG_MD_CONFIG_FILE_NAMES = ['config.yml', 'config.yaml'] as const
export const BACKLOG_MD_DEFAULT_STATUSES = ['To Do', 'In Progress', 'Done'] as const

export type BacklogMdTask = {
  id: string
  title: string
  status: string
  assignees: string[]
  labels: string[]
  priority: string | null
  milestone: string | null
  createdDate: string | null
  updatedDate: string | null
  dependencies: string[]
  parentTaskId: string | null
  description: string
  acceptanceCriteria: { total: number; checked: number }
  /** Task body without frontmatter or Backlog.md's section markers, ready to render. */
  body: string
  fileName: string
}

export type BacklogMdConfig = {
  projectName: string | null
  statuses: string[]
  defaultStatus: string | null
}

const FRONTMATTER_PATTERN =
  /^﻿?---[^\S\r\n]*(?:ya?ml)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/i
const SECTION_MARKER_LINE =
  /^[^\S\r\n]*<!--\s*(?:SECTION:[A-Z][A-Z0-9_]*|AC|DOD|COMMENTS?):(?:BEGIN|END)\s*-->[^\S\r\n]*$/gm
const CHECKLIST_LINE = /^[^\S\r\n]*[-*][^\S\r\n]+\[([ xX])\][^\S\r\n]+/

export function isBacklogMdTaskFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.md') && !/^readme\.md$/i.test(name)
}

/** Null when the file has no frontmatter id, i.e. it is not a Backlog.md task. */
export function parseBacklogMdTask(content: string, fileName: string): BacklogMdTask | null {
  const match = FRONTMATTER_PATTERN.exec(content)
  if (!match) {
    return null
  }
  const fields = parseFrontmatterFields(match[1] ?? '')
  const id = scalar(fields.id)
  if (!id) {
    return null
  }
  const rawBody = content.slice(match[0].length).replace(/\r\n/g, '\n')
  return {
    id,
    title: scalar(fields.title) ?? id,
    status: scalar(fields.status) ?? '',
    assignees: list(fields.assignee),
    labels: list(fields.labels),
    priority: scalar(fields.priority),
    milestone: scalar(fields.milestone),
    createdDate: scalar(fields.created_date),
    updatedDate: scalar(fields.updated_date),
    dependencies: list(fields.dependencies),
    parentTaskId: scalar(fields.parent_task_id),
    description: readSection(rawBody, 'DESCRIPTION', 'Description'),
    acceptanceCriteria: countAcceptanceCriteria(rawBody),
    body: rawBody
      .replace(SECTION_MARKER_LINE, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    fileName
  }
}

function isYamlMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseBacklogMdConfig(content: string): BacklogMdConfig {
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = parseYaml(content)
    if (isYamlMapping(parsed)) {
      data = parsed
    }
  } catch {
    // A broken config still leaves the tasks readable with the default statuses.
  }
  const statuses = list(data.statuses)
  return {
    projectName: scalar(data.project_name),
    statuses: statuses.length > 0 ? statuses : [...BACKLOG_MD_DEFAULT_STATUSES],
    defaultStatus: scalar(data.default_status)
  }
}

function parseFrontmatterFields(source: string): Record<string, unknown> {
  try {
    const parsed: unknown = parseYaml(quoteBareMentions(source))
    return isYamlMapping(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

// Backlog.md accepts `assignee: @name` and `- @name`; YAML reserves `@`, so quote them as Backlog.md does.
function quoteBareMentions(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(
          /^(\s*(?:assignee|reporter):\s*)(@[^\s#][^#]*?)(\s+#.*)?$/,
          (_m, prefix, value, comment = '') => `${prefix}${JSON.stringify(value.trim())}${comment}`
        )
        .replace(
          /^(\s*-\s+)(@[^\s#][^#]*?)(\s+#.*)?$/,
          (_m, prefix, value, comment = '') => `${prefix}${JSON.stringify(value.trim())}${comment}`
        )
        .replace(
          /^(\s*(?:assignee|reporter):\s*)\[(.*)\](\s*#.*)?$/,
          (_m, prefix, items: string, comment = '') =>
            `${prefix}[${items
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
              .map((item) => (item.startsWith('@') ? JSON.stringify(item) : item))
              .join(', ')}]${comment}`
        )
    )
    .join('\n')
}

function readSection(body: string, markerId: string, heading: string): string {
  const marked = new RegExp(
    `<!--\\s*SECTION:${markerId}:BEGIN\\s*-->([\\s\\S]*?)<!--\\s*SECTION:${markerId}:END\\s*-->`
  ).exec(body)
  if (marked) {
    return (marked[1] ?? '').trim()
  }
  const headed = new RegExp(
    `(?:^|\\n)##[^\\S\\n]+${heading}[^\\S\\n]*\\n([\\s\\S]*?)(?=\\n##[^\\S\\n]|$)`,
    'i'
  ).exec(body)
  return (headed?.[1] ?? '').replace(SECTION_MARKER_LINE, '').trim()
}

function countAcceptanceCriteria(body: string): { total: number; checked: number } {
  const marked = /<!--\s*AC:BEGIN\s*-->([\s\S]*?)<!--\s*AC:END\s*-->/.exec(body)
  const section = marked?.[1] ?? readSection(body, 'ACCEPTANCE_CRITERIA', 'Acceptance Criteria')
  let total = 0
  let checked = 0
  for (const line of section.split('\n')) {
    const item = CHECKLIST_LINE.exec(line)
    if (!item) {
      continue
    }
    total += 1
    if (item[1] !== ' ') {
      checked += 1
    }
  }
  return { total, checked }
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim() || null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

function list(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return items.map(scalar).filter((item): item is string => item !== null)
}
