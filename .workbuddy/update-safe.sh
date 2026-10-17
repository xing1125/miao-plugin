#!/usr/bin/env bash
# miao-plugin 安全更新（唯一推荐入口）
# 原理：本地定制已作为「显式提交」存在，所以 merge 只能报冲突、不可能静默覆盖。
#       —— 这正是旧脚本 update-merge.sh 的病根：它用 `git stash push -u`，
#          而 stash 内部会硬重置工作区，把 skip-worktree 文件直接换成上游版。
# 流程：前置检查 → 快照 → fetch → merge(-X ours，冲突保留本地) → 六项校验 → 失败自动回滚
# 上游远端自动探测：有 upstream 就拉 upstream，否则拉 origin（fork 后无需改脚本）
# 用法：bash .workbuddy/update-safe.sh            （可加 UPR=origin / UPR_BRANCH=master 覆盖）
set -u
P="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$P" || exit 1

die() { echo "!! $*"; exit 1; }

echo "[1/6] 前置检查"
if [ -n "$(git status --porcelain | grep -v '^??' || true)" ]; then
  echo "   工作区有未提交的已跟踪改动，先处理再更新："
  git status --short | grep -v '^??'
  die "已中止（不做任何暂存/重置动作）。请先 git add + commit，或丢弃这些改动。"
fi
PRE_HEAD="$(git rev-parse HEAD)"
OWN_COMMIT="$(git log --grep='本地定制' --format=%H -1)"
[ -n "$OWN_COMMIT" ] || die "找不到本地定制提交，拒绝更新（防止再次丢数据）"
echo "   工作区干净 ✓  更新前 HEAD=${PRE_HEAD:0:8}  本地定制提交=${OWN_COMMIT:0:8}"

echo "[2/6] 快照"
BK="$(bash .workbuddy/snapshot-custom.sh | tail -1 | tr -d '\r')"
[ -d "$BK" ] || BK="$(cat /d/yunzai-yingbot/_miao-custom-backup/LATEST.txt 2>/dev/null | tr -d '\r')"
[ -d "$BK" ] || die "快照失败，已中止"
echo "   快照: $BK"

echo "[3/6] 拉取上游"
# 上游远端自动探测：
#   - 未 fork 时 origin 就是上游（TimeRainStarSky/miao-plugin）
#   - fork 之后 origin 变成你自己的仓库，上游要挂在 upstream 上，
#     此时必须从 upstream 拉，否则会合到 fork 的旧快照（看起来"没更新"）。
# 想强制指定：UPR=origin bash .workbuddy/update-safe.sh
UPR="${UPR:-}"
if [ -z "$UPR" ]; then
  if git remote get-url upstream >/dev/null 2>&1; then UPR="upstream"; else UPR="origin"; fi
fi
UPR_BRANCH="${UPR_BRANCH:-master}"
git remote get-url "$UPR" >/dev/null 2>&1 || die "远端 $UPR 不存在，已中止（不做任何改动）"
echo "   上游远端: $UPR ($(git remote get-url "$UPR"))  分支: $UPR_BRANCH"
git fetch "$UPR" || die "fetch 失败（网络？），已中止，本地未改动"

echo "[4/6] 合并上游（冲突默认保留本地版 -X ours）"
if ! git merge --no-edit -X ours "$UPR/$UPR_BRANCH"; then
  echo "   合并未能自动完成 → 回滚"
  git merge --abort 2>/dev/null || true
  git reset --hard "$PRE_HEAD" >/dev/null 2>&1
  bash .workbuddy/restore-local-custom.sh "$BK" >/dev/null 2>&1
  die "合并冲突未能自动解决，已回滚到更新前状态"
fi

echo "[5/6] 四项校验"
FAIL=0
chk() { if eval "$2" >/dev/null 2>&1; then echo "   ✓ $1"; else echo "   ✗ $1"; FAIL=1; fi; }
chk "本地定制提交仍是 HEAD 祖先（没被丢掉）" "git merge-base --is-ancestor $OWN_COMMIT HEAD"
chk "ProfileDetail.js 含 getCardData"          "grep -q getCardData apps/profile/ProfileDetail.js"
chk "wave 卡模板存在"                          "test -f resources/character/profile-detail-wave.html"
chk "wave 卡样式存在"                          "test -f resources/character/profile-detail-wave.css"
chk "蓝玻璃主题仍挂载在 layout"                "grep -q blue-glass-theme resources/common/layout/default.html"
chk "无残留 stash"                             "! git stash list | grep -q ."

if [ "$FAIL" -ne 0 ]; then
  echo "[6/6] 校验未通过 → 自动回滚"
  git reset --hard "$PRE_HEAD" >/dev/null 2>&1
  bash .workbuddy/restore-local-custom.sh "$BK" >/dev/null 2>&1
  die "已回滚到更新前状态（快照保留在 $BK）"
fi

echo "[6/6] 更新完成 ✓   HEAD=${PRE_HEAD:0:8} → $(git rev-parse --short HEAD)"
echo "   本地定制完好。若本轮上游改到了本地定制文件，git 已自动保留本地版（-X ours）。"
echo "   如仍发现观感异常：bash .workbuddy/restore-local-custom.sh $BK"

# 立绘补齐会造成「已跟踪文件被改写」→ 工作区变脏 → 下次更新会被前置检查拦下，
# 所以改为按需开启：bash .workbuddy/update-safe.sh --with-art
if [ "${1:-}" = "--with-art" ]; then
  echo "[+] 补齐新角色立绘（--with-art，需外网）"
  if timeout 8 curl -sf https://api.hakush.in >/dev/null 2>&1; then
    node .workbuddy/miao-char-sync.mjs art --all-missing --write --promo-only || echo "    （立绘补齐失败，跳过）"
    node .workbuddy/miao-char-sync.mjs scan --write || echo "    （角色 data.json 自愈失败，跳过）"
    echo "    注意：本次改写了跟踪文件，请 git add + commit 后再进行下一次更新"
  else
    echo "    无外网，跳过"
  fi
else
  echo "[+] 跳过立绘补齐（如需：bash .workbuddy/update-safe.sh --with-art）"
fi
