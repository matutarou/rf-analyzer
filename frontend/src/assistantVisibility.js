export const ASSISTANT_HIDDEN_KEY = 'rf_analyzer_assistant_hidden'

export function parseAssistantHidden(value) {
  return value === 'true'
}

export function readAssistantHidden(storage) {
  try {
    return parseAssistantHidden((storage ?? globalThis.localStorage).getItem(ASSISTANT_HIDDEN_KEY))
  } catch {
    return false
  }
}

export function writeAssistantHidden(hidden, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(ASSISTANT_HIDDEN_KEY, String(hidden))
    return true
  } catch {
    return false
  }
}
