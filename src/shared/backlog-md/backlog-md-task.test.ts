import { describe, expect, it } from 'vitest'
import { parseBacklogMdConfig, parseBacklogMdTask } from './backlog-md-task'

// Shape written by Backlog.md 1.x (from its own backlog/tasks folder).
const TASK = `---
id: BACK-268
title: Show agent instruction version status
status: In Progress
assignee:
  - '@codex'
created_date: '2025-09-17 19:19'
labels: [cli, agents]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Expose tooling so users can see whether their agent files match.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reports local vs bundled version
- [ ] #2 Handles missing files
<!-- AC:END -->
`

describe('parseBacklogMdTask', () => {
  it('reads frontmatter, the description and acceptance progress, and drops section markers', () => {
    const task = parseBacklogMdTask(TASK, 'back-268 - Show-agent-instruction-version-status.md')
    expect(task).toMatchObject({
      id: 'BACK-268',
      title: 'Show agent instruction version status',
      status: 'In Progress',
      assignees: ['@codex'],
      labels: ['cli', 'agents'],
      createdDate: '2025-09-17 19:19',
      description: 'Expose tooling so users can see whether their agent files match.',
      acceptanceCriteria: { total: 2, checked: 1 }
    })
    expect(task?.body).not.toContain('<!--')
  })

  it('accepts the bare @mentions Backlog.md allows although YAML reserves @', () => {
    const task = parseBacklogMdTask(
      '---\nid: task-1\ntitle: T\nassignee: @alice\nreporter: [@bob, carol]\n---\n',
      't.md'
    )
    expect(task?.assignees).toEqual(['@alice'])
  })

  it('rejects Markdown without a task id', () => {
    expect(parseBacklogMdTask('# Notes\n', 'readme.md')).toBeNull()
    expect(parseBacklogMdTask('---\ntitle: No id\n---\n', 'x.md')).toBeNull()
  })
})

describe('parseBacklogMdConfig', () => {
  it('falls back to the default statuses when the config has none or is broken', () => {
    expect(parseBacklogMdConfig('statuses: ["Todo", "Doing"]\n').statuses).toEqual([
      'Todo',
      'Doing'
    ])
    expect(parseBacklogMdConfig(': : :').statuses).toEqual(['To Do', 'In Progress', 'Done'])
  })
})
