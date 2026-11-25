import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  _resetAzureDevOpsApiVersionCache,
  azureDevOpsApiVersionForOrigin,
  recordAzureDevOpsApiVersionRejection,
  resolveAzureDevOpsGitApiBaseUrl
} from './azure-devops-api-request'
import { resolveAzureDevOpsApiBases } from './boards/api-bases'
import { parseAzureDevOpsRepoRef } from './repository-ref'

const OLD_ENV = process.env

beforeEach(() => {
  process.env = { ...OLD_ENV }
  delete process.env.ORCA_AZURE_DEVOPS_API_BASE_URL
  _resetAzureDevOpsApiVersionCache()
})
afterEach(() => {
  process.env = OLD_ENV
})

describe('Azure DevOps Server SSH remotes', () => {
  it('reads an ssh:// remote as the same server over HTTPS', () => {
    const repo = parseAzureDevOpsRepoRef(
      'ssh://ado.example.com:22/tfs/DefaultCollection/My%20Project/_git/my-repo'
    )
    expect(repo).toMatchObject({
      host: 'ado.example.com',
      organization: null,
      project: 'My Project',
      repository: 'my-repo',
      apiBaseUrl: 'https://ado.example.com/tfs/DefaultCollection/My%20Project'
    })
  })

  it('reads an scp-style remote', () => {
    expect(
      parseAzureDevOpsRepoRef('git@ado.example.com:DefaultCollection/Project/_git/repo')?.apiBaseUrl
    ).toBe('https://ado.example.com/DefaultCollection/Project')
  })

  it('leaves other SSH remotes alone', () => {
    expect(parseAzureDevOpsRepoRef('git@github.com:acme/repo.git')).toBeNull()
    expect(parseAzureDevOpsRepoRef('ssh://git@gitlab.example.com/group/repo.git')).toBeNull()
    // Without a collection there is no Azure DevOps Server path.
    expect(parseAzureDevOpsRepoRef('ssh://host/Project/_git/repo')).toBeNull()
  })
})

describe('ORCA_AZURE_DEVOPS_API_BASE_URL on another URL than the remote', () => {
  const sshRepo = () =>
    parseAzureDevOpsRepoRef('ssh://ado.example.com:22/DefaultCollection/Project/_git/repo')!

  it('treats a collection URL as the collection, so Boards finds the project', () => {
    process.env.ORCA_AZURE_DEVOPS_API_BASE_URL = 'https://ado.example.com/tfs/DefaultCollection/'
    expect(resolveAzureDevOpsGitApiBaseUrl(sshRepo())).toBe(
      'https://ado.example.com/tfs/DefaultCollection/Project'
    )
    expect(resolveAzureDevOpsApiBases(sshRepo()).collection).toBe(
      'https://ado.example.com/tfs/DefaultCollection'
    )
  })

  it('keeps a project URL as configured', () => {
    process.env.ORCA_AZURE_DEVOPS_API_BASE_URL =
      'https://ado.example.com/tfs/DefaultCollection/project'
    expect(resolveAzureDevOpsGitApiBaseUrl(sshRepo())).toBe(
      'https://ado.example.com/tfs/DefaultCollection/project'
    )
  })

  it('still prefers the remote project path under a configured ancestor', () => {
    process.env.ORCA_AZURE_DEVOPS_API_BASE_URL = 'https://ado.example.com'
    expect(resolveAzureDevOpsGitApiBaseUrl(sshRepo())).toBe(
      'https://ado.example.com/DefaultCollection/Project'
    )
  })
})

describe('API version negotiation', () => {
  it('steps through every Server release version', () => {
    const origin = 'https://ado.example.com'
    const seen = [azureDevOpsApiVersionForOrigin(origin)]
    const outOfRange = JSON.stringify({ typeKey: 'VssVersionOutOfRangeException' })
    while (
      recordAzureDevOpsApiVersionRejection(
        new URL(`${origin}/_apis/projects?api-version=${seen.at(-1)}`),
        400,
        outOfRange
      )
    ) {
      seen.push(azureDevOpsApiVersionForOrigin(origin))
    }
    expect(seen).toEqual(['7.1', '7.0', '6.1', '6.0', '5.1', '5.0'])
  })
})
