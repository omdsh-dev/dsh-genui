import { type GenuiActionHandler } from './action-context.ts';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Injection face built per session in apply (scoped conversation send). */
export interface GenuiPanelInjected {
    sessionId: string;
    sendGenuiAction: GenuiActionHandler;
    /** Template center "try it": insert the template instruction into the
     *  current composer draft (standard conversation.input.for channel). */
    insertTemplate: (text: string) => void;
}
export type GenuiPanelProps = PropsRuntime<'conversation.input.dock'> & GenuiPanelInjected;
/**
 * Panel dock entry. Renders nothing until the session's toolview published a
 * spec; afterwards the SAME block re-renders on every publish. Collapsed by
 * default so the dock never steals the message flow's scroll room; the
 * header always shows the current panel title.
 */
export declare function GenuiPanel({ sessionId, sendGenuiAction, insertTemplate }: GenuiPanelProps): import("react").JSX.Element | null;
