import {
  DEFAULT_CONNECTION_STATE,
  DEFAULT_RUN_STATE,
  type ConnectionState,
  type RunState,
} from './protocol'

const RUN_STATE_KEY = 'salesos.runState'
const CONNECTION_KEY = 'salesos.connection'

export async function loadRunState(): Promise<RunState> {
  const result = await chrome.storage.local.get(RUN_STATE_KEY)
  return { ...DEFAULT_RUN_STATE, ...(result[RUN_STATE_KEY] as Partial<RunState> | undefined) }
}

export async function saveRunState(runState: RunState): Promise<void> {
  await chrome.storage.local.set({ [RUN_STATE_KEY]: runState })
}

export async function loadConnectionState(): Promise<ConnectionState> {
  const result = await chrome.storage.local.get(CONNECTION_KEY)
  return {
    ...DEFAULT_CONNECTION_STATE,
    ...(result[CONNECTION_KEY] as Partial<ConnectionState> | undefined),
  }
}

export async function saveConnectionState(connection: ConnectionState): Promise<void> {
  await chrome.storage.local.set({ [CONNECTION_KEY]: connection })
}
