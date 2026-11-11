# Media inventory — real assets usable on the new site

Audit date: 2026-11-09. Source checkout: `/Users/changfenhuang/projects/dsh-genui` @ `c2624ce`
(read-only). Dimensions from `sips -g pixelWidth -g pixelHeight`; video metadata from `mdls`.
Every file below is a **real capture from the plugin repository** (none were generated for this site).

## Inventory

| File | Kind | Dimensions | Bytes | What it actually shows | Real or mock | Attribution / license | Caption + disclaimer needed? |
|---|---|---|---|---|---|---|---|
| `assets/demo.mp4` | video (screen recording) | 1152×720, **53.1 s**, H.264 + AAC | 2,608,997 | Four-act real DSH session: ① layout + streaming data components, ② interactive components (tabs, form controls, copy), ③ visualization/teaching (`plot` parameter sliders + animation, `quiz` grading, `mermaid`, `scene3d`), ④ action event loop (click → model reply → new panel). Scene scripts in `demo-prompts.md` (four acts). README labels it “40-Second Walkthrough” but the actual runtime is **53.1 s**. | **Real** — README.md:41: “All recordings and screenshots … captured directly from real DSH interface rendering — no conceptual mockups or faked pre-renders.” | Repo asset, MIT (repo `LICENSE`); records the DeepSeek Harness UI; no third-party footage. | Caption: “仓库原始录屏 · 真实 DSH 会话”。Do **not** write “40 秒”；say nothing about duration, or “53 秒”。The recording contains the DSH sidebar/session titles → prefer the existing dark crop or keep it small. |
| `assets/demo-thumb.png` | screenshot (video poster) | 960×600 | 161,552 | A dark-theme DSH conversation frame (“交互控件类”, `button` tones) — but the PNG carries a **large solid-white circle in the center with no play triangle**, and its sidebar lists a user's personal session names. | Real capture, but the poster overlay is **broken** (verified by cropping the centre: pure white disc, no glyph). | Repo asset, MIT. | **Do not use as-is.** It looks like a rendering bug and leaks session titles. Replace with a first-frame poster (below) or a showcase still. |
| `assets/showcase-panel.png` | screenshot (component render) | 1440×980 | 90,117 | Light-theme real render: stat cards (服务在线率 / 算力 CPU 42% / 容量内存 6.8 GB), filterable service table (“筛选服务 / 状态”, 输入关键字即时过滤), grouped totals by 区域 (华东/华北) with 合计行, spark + ring cells, and a main-detail table with `#`, 可用率 ring, 负载 bar, 状态 badge. | **Real** (README.md:60-63 caption: “Monitoring Panel: Answer is the Dashboard”). | Repo asset, MIT. | Yes: it is a **light-theme** capture on a dark site → caption “浅色主题 · 仓库原始截图” (plus what it shows). No DSH chrome in frame. |
| `assets/showcase-plot.png` | screenshot (component render) | 1440×800 | 71,286 | Light-theme real render of a `plot` node titled “波动叠加（拖动滑块即时重绘）” with two curves, axis labels and a parameter slider. | **Real** (README.md:60-63 caption: “Function Plot: Drag to Redraw Instantly”). | Repo asset, MIT. | Same light-theme disclaimer. |
| `assets/showcase.png` | screenshot (component render) | 1440×800 | 84,415 | Light-theme real render: “摘要” stat cards (在线率 99.96%, CPU 42% + sparkline, 内存 6.8 GB), ring progress “训练进度 72% / 目标 80%”, “数据” divider, 性能指标 table and 清单 list. | **Real** (README.md:60-63 caption: “Composable Hierarchy: Work Surface”). | Repo asset, MIT. | Same light-theme disclaimer. |
| `docs/screenshots/achievements.png` | screenshot | 1440×900 | 96,894 | Full DSH window (sidebar + chat) with the GenUI panel dock open on the “成就” tab: 2/12 unlocked, progress 17 %, rarity-tagged trophy list. Shows a personal session title and app chrome. | Real, but **diagnostic/feature doc capture**, not an art-directed interface shot. | Repo asset, MIT. | Not recommended for the site: contains full DSH chrome + personal session names; conflicts with DESIGN.md's “no simulated DSH window” stance. If used, crop to the panel only and caption it. |
| `docs/screenshots/template-center.png` | screenshot | 1440×900 | 119,250 | Full DSH window with “GenUI 模板中心” panel dock: category chips 全部/仪表盘/数据/流程/图表/交互/测验/高级 and template cards. Same chrome/personal-session issue. | Real, diagnostic. | Repo asset, MIT. | Same as above (crop + caption). |
| `docs/screenshots/issue-159-light-surface.png` | screenshot (composite) | 1400×1034 | 190,339 | Before/after diagnostic composite for issue #159 (light card surface): big Chinese headline “#159 改前 / 改后”, two groups of stat/plot/table surfaces. | Real, but a **bug-diagnostic board**, not a product shot. | Repo asset, MIT. | Not for the site (diagnostic title text baked in). |
| `docs/screenshots/issue-183-wordcloud-svg.png` | screenshot | 1440×790 | 135,752 | Light-theme diagnostic board: ECharts sankey, `wordCloud` preset, `svg` preview, plot capture. | Real, diagnostic. | Repo asset, MIT. | Not for the site. |
| `assets/genui-icon.svg` / `assets/genui-logo.svg` | vector marks | 24-ish / wordmark | 982 / 1,461 | Product icon and wordmark. | Repo assets. | Repo, MIT. | Already used by `index.html` (`assets/img/genui-icon.svg` etc.). |

## Recommendation for the Evidence section

1. **Video: use `assets/demo.mp4`.** It is the only dark-theme, full-product, real proof; 53.1 s,
   1152×720, H.264 — fine for `preload="none"` + `controls`. Caption: **“仓库原始录屏 · 真实 DSH 会话”**
   (zh) / **“Original repo recording · real DSH session”** (en). Don't repeat README's “40-second”.
2. **Poster: do not use `demo-thumb.png`.** Either
   - extract a real first frame (best): `ffmpeg -ss 1 -i assets/demo.mp4 -frames:v 1 -q:v 2 poster.jpg`
     (local `ffmpeg` is currently broken: `Library not loaded: …/libx265.216.dylib` — run
     `brew reinstall x265 ffmpeg` or extract on another machine / via Safari), or
   - use `showcase-panel.png` (component-only, no chrome) with the light-theme caption.
3. **Stills: `showcase-panel.png` is the strongest single still** (table + stats + rings + bars all in one
   real reply). `showcase-plot.png` is the best “locally interactive” still. `showcase.png` is the weakest
   of the three (table/list, less distinctive). All three are **light theme**, so if Evidence is dark,
   either (a) caption them “浅色主题 · 仓库原始截图”, or (b) show them inside a framed figure with a
   light-on-light border so the brightness reads as intentional.
4. **Avoid all four `docs/screenshots/*` files on the site.** They contain full DSH chrome, personal
   session titles, or baked-in diagnostic headlines; DESIGN.md explicitly rules out a simulated DSH
   window and the site should not look like a screenshot deck.
5. None of these screenshots are mocks — the README statement quoted above covers all of them.

## Attribution / legal

- Everything in `assets/` and `docs/screenshots/` is produced by the project and covered by the
  repository's MIT license (`LICENSE`, Copyright (c) 2026 dsh-external).
- The recording and screenshots include the DeepSeek Harness UI and the DeepSeek wordmark/logo. The site
  already carries an “unofficial / not endorsed by DeepSeek” disclaimer in the footer — that is the
  right place for this; no per-image attribution is required.
- The bundled 749 glyph icons come from OpenAI Apps SDK UI (MIT) and are credited in
  `THIRD_PARTY_NOTICES.md`; that notice only matters if the page itself renders the icon set, not for
  these screenshots.
- Personal data check: `demo-thumb.png`, `achievements.png` and `template-center.png` show the author's
  own session titles (“确认open-sea-skin优化提RP情…”, “Annotation_for_dsh”, “side for dash”, …). They are
  harmless but not something a product site should publish — crop or avoid.
