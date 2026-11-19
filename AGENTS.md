# dsh-genui 协作守则

面向在本仓库里改东西的 agent。只写会被反复违反、且有具体代价的规则；风格偏好不进来。

## 汇报改动：默认用 `compare`

只要回答里要呈现**同一处界面的前后差异**，就用 `compare` 节点，不要并排两张 markdown 图片、也不要表格：

````
```dsh-ui
{"title":"改了什么","items":[{"type":"compare","mode":"side","height":360,
 "before":{"src":"/api/file?path=<绝对路径，percent-encoded>","label":"改动前","caption":"…"},
 "after":{"src":"/api/file?path=<绝对路径，percent-encoded>","label":"改动后","caption":"…"}}]}
```
````

- 本机截图走宿主已鉴权的 `/api/file?path=` 路由，不用起服务、不用搬文件。
- 为什么不是两张图：读者得自己推理"哪边是改前"；`compare` 的标签常显，还能拖动分割线看细节。
- 规则失效过一次（当天写进 SKILL，第一次汇报就没用），所以放在这个每次都会加载的位置。
- 没有截图时用文字讲清楚，不要用表格凑出一张"看起来有结构"的回答。

## 视觉改动：没渲染过就不算完成

- 视觉/布局/交互改动必须在真实浏览器里看过再声称完成。本地有固定管线：
  `.e2e-artifacts/pw/`（`playwright-core`）+ `.e2e-artifacts/.browsers/`（chromium），`PLAYWRIGHT_BROWSERS_PATH` 指过去即可截图。
- 导出页（standalone artifact）没有宿主 `--dsw-*` token：判断颜色/表面/字体时必须把宿主 token 一起注入，否则看到的是兜底色（过去因此误判过 `diagram` 是"白板"）。
- 断言要随行为变化说明**新规则是什么**，不要只把期望值改成实际值。

## 新增节点：一份清单

`spec.ts`（类型 + union）→ `genui-runtime/schema.ts`（字段 + 嵌套记录）→ `guard.ts`（repair + 校验）→ `blocks/render-node.tsx`（dispatch）→ 组件 + CSS module → `i18n/{en,zh}.ts`（键集必须一致）→ `SKILL.md` → 测试（渲染 + 交互 + guard）。

系统提示里那段组件清单有 3400 字符硬预算（`tests/plugin-genui.spec.ts` 会拦），新增类型先看够不够位置。

## 隐藏与禁用：必须交代"值怎么办"

任何让控件消失或不可用的改动，同时回答两个问题：

1. 值还提交吗？（`when`：不提交，也不占"已填"名额）
2. 读者看不见的旧值会不会被当成有效输入？（不能）

只做视觉隐藏、不处理提交语义，等于给用户塞一个陷阱。
