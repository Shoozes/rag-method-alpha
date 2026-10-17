// The basic chat and optional memory workspace share only this storage boundary.
// It imports no memory, model, runtime, browser-cache or graph implementation.
export const storageKey = 'private-one-chat-memory-v1';
export const defaultWorkspaceOwner = Object.freeze({ actorId: 'local-user', personaId: 'local-assistant', conversationId: 'local-chat' });
export const resetStorageSchema = 'private-one-chat-memory-reset/v1';
export const workspaceStorageKey = owner => Object.keys(defaultWorkspaceOwner).every(key => owner[key] === defaultWorkspaceOwner[key])
  ? storageKey : storageKey + ':' + JSON.stringify([owner.actorId, owner.personaId, owner.conversationId]);
export const sharedWorkspaceStorageKeys = owner => ['private-persona-memory-v1:' + JSON.stringify([owner.actorId, owner.personaId]),
  'private-global-memory-v1:' + JSON.stringify([owner.actorId])];
export function isWorkspaceResetMarker(value, owner) {
  return value?.schema === resetStorageSchema && JSON.stringify(value.owner) === JSON.stringify(owner)
    && typeof value.epoch === 'string' && value.epoch.length > 0 && value.epoch.length <= 100
    && typeof value.pending === 'boolean' && Object.keys(value).length === 4;
}
// A tiny reset marker invalidates saves from an older tab even when the old
// conversation was empty. It contains no chat, memory or model-cache bytes.
export function clearWorkspaceStorage({ storage, owner = defaultWorkspaceOwner, epoch = crypto.randomUUID() } = {}) {
  if (!storage) return { cleared: true, durable: false };
  try {
    const marker = { schema: resetStorageSchema, owner, epoch, pending: true };
    storage.setItem(workspaceStorageKey(owner), JSON.stringify(marker));
    for (const key of sharedWorkspaceStorageKeys(owner)) storage.removeItem(key);
    storage.setItem(workspaceStorageKey(owner), JSON.stringify({ ...marker, pending: false }));
    return { cleared: true, durable: true };
  } catch (error) { return { cleared: false, durable: false, error: error.message }; }
}
