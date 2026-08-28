#!/bin/sh
# dsh-genui 一键安装脚本（通过 npm 公开包安装，无需 npm 账号）
#
# 用法:
#   ./scripts/install.sh            # 装进默认 web profile
#   ./scripts/install.sh tui        # 装进自定义 profile
#
# 做什么: 检查两个前置（dsh / pnpm）→ 从 npm 安装插件
# → 同步 genui skill（带文件安全边界）→ 提示重启验证。
# 与手装唯一区别是多了前置自检，安装命令本身和 README 一致。

set -eu

PROFILE="${1:-web}"

# ── profile 参数只允许安全字符（随后会被拼进路径与 node 环境变量）──
case "$PROFILE" in
  *[!a-zA-Z0-9_-]*|'') fail_early=1 ;;
  *) fail_early=0 ;;
esac
if [ "$fail_early" = 1 ]; then
  printf '\033[31m✗ 非法的 profile 名 "%s"（仅允许字母、数字、_、-）\033[0m\n' "$PROFILE"
  exit 1
fi

PACKAGE_SPEC="@changfenhuang/dsh-genui"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
# Web 会话的 skill 服务从 agentsHome（默认 ~/.agents）发现技能，dshHome 的
# ~/.dsh/skills 在部分宿主演进中不再进入会话目录 —— 两个根都同步，模型从哪
# 个根读都能拿到 genui skill。
AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"
RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; BOLD='\033[1m'; NC='\033[0m'

fail() { printf "${RED}✗ %s${NC}\n" "$1"; exit 1; }
ok()   { printf "${GREEN}✓ %s${NC}\n" "$1"; }
warn() { printf "${YELLOW}! %s${NC}\n" "$1"; }

# ── skill 同步：模型从技能根读 SKILL.md，不是仓库那份 ──
# 从已安装的包内解析 SKILL.md（正常安装来自 npm；开发机 link 安装会解析
# 到本地 checkout）。目标按七类状态处理，任何情况下都不跟随写入别人的文件：
#   不存在 / 普通文件  → 同目录临时文件 + 原子 mv（创建或替换）
#   符号链接指向同一文件 → 成功跳过，不改链接（开发机 ln -s 场景）
#   符号链接指向其他文件 → 安全失败，显示目标
#   悬空符号链接        → 安全失败
#   目录               → 安全失败
sync_skill_to() {
  SKILL_FILE="$1"
  DEST="$2"
  DEST_LABEL="$3"

  # 符号链接判定（readlink 解析一次；相对目标按链接所在目录展开）
  if [ -L "$DEST" ]; then
    LINK_TARGET=$(readlink "$DEST")
    case "$LINK_TARGET" in
      /*) RESOLVED="$LINK_TARGET" ;;
      *)  RESOLVED="$(cd "$(dirname "$DEST")" && pwd -P)/$LINK_TARGET" ;;
    esac
    # 指向同一文件 → 跳过（dev 的 ln -s checkout 场景）。字符串比较 +
    # canonical 比较兜底（/var vs /private/var、.. 段等路径差异）。
    canonical() {
      ( cd "$(dirname "$1")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$1")" ) || printf '%s\n' "$1"
    }
    if [ "$RESOLVED" = "$SKILL_FILE" ] || [ "$(canonical "$RESOLVED")" = "$(canonical "$SKILL_FILE")" ]; then
      ok "skill 已是最新（$DEST_LABEL 符号链接指向同一文件）"
      return 0
    fi
    if [ -e "$RESOLVED" ] || [ -L "$RESOLVED" ]; then
      fail "目标 $DEST 是指向其他文件的符号链接（-> ${RESOLVED}），拒绝写入。请手动处理后重试。"
    fi
    fail "目标 $DEST 是悬空符号链接（-> ${RESOLVED}），拒绝写入。请手动处理后重试。"
  fi
  if [ -d "$DEST" ]; then
    fail "目标 $DEST 是目录，拒绝覆盖。请手动处理后重试。"
  fi

  # 不存在 / 普通文件：同目录临时文件 + 原子 mv，异常退出清理临时文件
  mkdir -p "$(dirname "$DEST")"
  TMP_FILE="$DEST.tmp.$$"
  trap 'rm -f "$TMP_FILE"' EXIT HUP INT TERM
  cp "$SKILL_FILE" "$TMP_FILE"
  mv "$TMP_FILE" "$DEST"
  trap - EXIT HUP INT TERM
  ok "skill 已同步到 ${DEST_LABEL}（${SKILL_FILE}）"
}

sync_skill() {
  echo "同步 genui skill ..."
  # 用户可控路径经环境变量传给 node，绝不插进 -e 字符串（防注入）。
  # 先 cd 到中性目录再解析：在插件 checkout 里跑脚本时，node 的
  # self-reference 会把包名解析回当前仓库，必须避开。
  mkdir -p "$DSH_HOME"
  SKILL_FILE=$(cd "$DSH_HOME" && DSH_HOME="$DSH_HOME" PROFILE="$PROFILE" node -e "
const path = require('path')
try {
  const pkg = require.resolve('@changfenhuang/dsh-genui/package.json', { paths: [process.env.DSH_HOME + '/profiles/' + process.env.PROFILE] })
  console.log(path.join(path.dirname(pkg), 'SKILL.md'))
} catch { process.exit(1) }
" 2>/dev/null || true)
  if [ -z "$SKILL_FILE" ] || [ ! -f "$SKILL_FILE" ]; then
    fail "无法定位已安装包内的 SKILL.md —— 安装不完整，请先修复插件安装再重试。"
  fi

  sync_skill_to "$SKILL_FILE" "$DSH_HOME/skills/genui/SKILL.md" "DSH_HOME/skills/genui"
  sync_skill_to "$SKILL_FILE" "$AGENTS_HOME/skills/genui/SKILL.md" "AGENTS_HOME/skills/genui"
}

echo "${BOLD}== dsh-genui 安装（profile: ${PROFILE}）==${NC}"

# ── 前置 1: dsh ────────────────────────────────────────────────────────────
if ! command -v dsh >/dev/null 2>&1; then
  fail "未找到 dsh 命令。请先安装 DeepSeek Harness（开源版），再跑本脚本。"
fi
ok "dsh: $(dsh --version 2>/dev/null || echo present)"

# ── 前置 2: pnpm（缺失时只给提示，绝不自动 corepack enable 改用户全局）──
if ! command -v pnpm >/dev/null 2>&1; then
  fail "未找到 pnpm。请手动执行: 'corepack enable'（或 'npm i -g pnpm'），新开终端确认 'pnpm -v' 有输出后重跑本脚本。"
fi
ok "pnpm: $(pnpm --version)"

# ── 已装检测（幂等）────────────────────────────────────────────────────────
PROFILE_PKG="$DSH_HOME/profiles/$PROFILE/package.json"
if [ -f "$PROFILE_PKG" ] && grep -q "dsh-genui" "$PROFILE_PKG" 2>/dev/null; then
  warn "插件已在 profile '$PROFILE' 中。"
  sync_skill
  printf "  想重装就手动执行: dsh plugin --profile %s remove @changfenhuang/dsh-genui，再跑本脚本。\n" "$PROFILE"
  printf "  否则直接: 重启 dsh web + 硬刷新 即可验证。\n"
  exit 0
fi

# ── 安装 ───────────────────────────────────────────────────────────────────
echo "安装中（从 npm 拉取公开包并安装依赖）..."
dsh plugin --profile "$PROFILE" add "$PACKAGE_SPEC"
sync_skill

echo
ok "安装完成！"
echo
echo "${BOLD}接下来:${NC}"
echo "  1. 重启 dsh web（退出后重新执行 dsh web）"
echo "  2. 浏览器硬刷新（Cmd+Shift+R）"
echo "  3. 新会话里说: 用 dsh-ui 画个统计看板"
echo
