import type { CommandSpec } from '../discovery/command-spec'
import { CLI_GLOBAL_FLAGS as GLOBAL_FLAGS } from '../../shared/cli/cli-argument-boundary'

export const PORTS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ports'],
    summary: 'List the listening ports Orca detected for a workspace',
    usage: 'orca ports [--worktree <selector>] [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'all'],
    notes: [
      'Defaults to the Orca workspace that contains the current directory.',
      'Scans the host the workspace runs on and lists the ports Orca tied to it, by process working directory (match=cwd) or command line (match=command).',
      '--all lists every listener found on that host, including other workspaces and processes Orca could not tie to one. A native folder workspace needs --all, because Orca does not tie ports to folders.',
      'url is the address the dev server printed in an Orca terminal; it is missing when Orca did not see one.'
    ],
    examples: [
      'orca ports',
      'orca ports --worktree branch:feature/login --json',
      'orca ports --all',
      "orca ports --json | jq -r '.result.ports[0].advertisedUrl'"
    ]
  },
  {
    path: ['ports', 'public-url'],
    summary: "Print a browser URL for a localhost port on an Eclipse Che server's public route",
    usage: 'orca ports public-url --port <n> [--path </p>] [--bare] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'port', 'path', 'bare'],
    notes: [
      'Only Che servers publish ports; elsewhere the port is already reachable as localhost.',
      'Path routes (…/6768/__orca/port/<n>/) need apps that use relative URLs or the base path in $ORCA_PORT_PUBLIC_PATH_PREFIX.',
      'With subdomain slots the port takes a slot (the least recently used one moves) and the URL carries a one-time sign-in ticket valid for 60 seconds; --bare prints the URL without it.'
    ],
    examples: [
      'orca ports public-url --port 5173',
      'orca ports public-url --port 8000 --path /docs'
    ]
  }
]
