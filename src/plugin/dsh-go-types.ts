/** The existing dsh-go v1 service, used without a runtime SDK dependency. */
export type NativeView = { type: string; [key: string]: unknown }
export interface NativeScope { sessionId?: string; messageId?: string; callId?: string }
export interface NativeEvent { action?: string; value?: unknown; locale: string }
export interface NativeCaps { locale: string; components: string[] }
export type NativeEffect = { type: 'refresh'; id?: string } | { type: 'copy' | 'toast' | 'insert'; text: string } | { type: 'link'; url: string }
export interface NativeBridge {
  panel(id: string, definition: {
    view(scope: NativeScope, caps: NativeCaps): NativeView
    data?(scope: NativeScope, emit: (data: Record<string, unknown>) => void): () => void
  }): () => void
  on(id: string, handler: (scope: NativeScope, event: NativeEvent) => NativeEffect[] | Promise<NativeEffect[]>): () => void
  refresh(id: string, scope?: NativeScope): void
}

export interface NativeState {
  fields: Record<string, string>
  choices: Record<string, string[]>
  tabs: Record<string, number>
  feedback: Record<string, string>
}

export function emptyNativeState(): NativeState {
  return { fields: Object.create(null), choices: Object.create(null), tabs: Object.create(null), feedback: Object.create(null) }
}

declare module '@deepseek-ai/cordis' {
  interface Context { dshGo: NativeBridge }
}
