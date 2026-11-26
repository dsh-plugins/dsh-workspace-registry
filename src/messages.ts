import { createRequire } from 'node:module'

type Messages = Record<'fieldText' | 'invalidField' | 'fieldArray' | 'remote' | 'entry' | 'absolute' | 'wildcard' | 'entries' | 'duplicate' | 'unavailable' | 'source', string>
const require = createRequire(import.meta.url)

/** Operator diagnostics follow the host process language; wire codes stay stable. */
export function messagesFor(locale: string): Messages {
  const base = locale.toLowerCase().split('-')[0]
  const language = ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'].includes(base) ? base : 'en'
  return (require(`../locale/${language}.json`) as { messages: Messages }).messages
}

export const messages = messagesFor(Intl.DateTimeFormat().resolvedOptions().locale)
