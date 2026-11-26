/**
 * Ends one streaming request on the socket that sent it, as closing a socket of its own would.
 * With it, a client can run many subscriptions over one socket instead of one socket each.
 */
export const RUNTIME_RPC_CANCEL_METHOD = 'rpc.cancel'

// Hosts without it keep a cancelled stream running, so clients give each subscription its own socket.
export const RUNTIME_RPC_CANCEL_CAPABILITY = 'runtime.rpc-cancel.v1' as const

export type RuntimeRpcCancelParams = { id: string }
export type RuntimeRpcCancelResult = { cancelled: boolean }
