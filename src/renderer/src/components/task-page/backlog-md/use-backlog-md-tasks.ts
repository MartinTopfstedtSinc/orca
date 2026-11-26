import { useEffect, useState } from 'react'
import type { Repo } from '../../../../../shared/repository/repo-types'
import { useAppStore } from '@/store'
import { loadBacklogMdRepoTasks, type BacklogMdRepoTasks } from './backlog-md-task-loader'

export function useBacklogMdTasks(
  repos: readonly Repo[],
  refreshNonce: number
): { loading: boolean; results: BacklogMdRepoTasks[] } {
  const [state, setState] = useState<{ key: string; results: BacklogMdRepoTasks[] } | null>(null)
  const reposKey = repos.map((repo) => repo.id).join(',')
  const requestKey = `${reposKey}#${refreshNonce}`
  useEffect(() => {
    let current = true
    const worktrees = useAppStore.getState().allWorktrees()
    void Promise.all(repos.map((repo) => loadBacklogMdRepoTasks(repo, worktrees))).then(
      (results) => {
        if (current) {
          setState({ key: requestKey, results })
        }
      }
    )
    return () => {
      current = false
    }
  }, [repos, requestKey])
  return {
    loading: state?.key !== requestKey,
    results: state?.results ?? []
  }
}
