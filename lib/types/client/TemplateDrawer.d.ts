export interface TemplateDrawerProps {
    /** 试用：把模板指令插入当前输入框草稿。 */
    onUse: (instruction: string) => void;
}
export declare function TemplateDrawer({ onUse }: TemplateDrawerProps): import("react").JSX.Element;
