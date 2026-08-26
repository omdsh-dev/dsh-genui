export interface TemplateDrawerProps {
    /** 试用：把模板指令插入当前输入框草稿。 */
    onUse: (instruction: string) => void;
    /** 当前面板（模板中心/成就页），由面板 header 按钮控制。 */
    tab: 'templates' | 'achievements';
}
export declare function TemplateDrawer({ onUse, tab }: TemplateDrawerProps): import("react").JSX.Element;
