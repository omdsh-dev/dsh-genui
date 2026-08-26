export interface TemplateDrawerProps {
    /** 试用：把模板指令插入当前输入框草稿。 */
    onUse: (instruction: string) => void;
    /** 当前 tab（由面板 header 按钮决定）。 */
    tab: 'templates' | 'achievements';
    /** 切 tab（面板 header 按钮同步）。 */
    onSwitchTab: (tab: 'templates' | 'achievements') => void;
}
export declare function TemplateDrawer({ onUse, tab, onSwitchTab }: TemplateDrawerProps): import("react").JSX.Element;
