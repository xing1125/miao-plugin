// 幽境危战 / 深境螺旋 / 幻想真境剧诗 · 期次信息卡查询
// 数据源：nanoka 公开静态 JSON（测试服 datamine 成品），怪物图标优先 Lotus 本地图库
// 指令：#幽境危战信息 | #幽境危战预告 | #深渊信息 | #深渊预告 | #剧诗信息 | #剧诗预告（"信息预告"连写亦兼容）
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { App, Common } from '#miao'
import { miaoPath } from '#miao.path'

const require = createRequire(import.meta.url)
const logger = global.logger || console

const BASE = 'https://static.nanoka.cc'
const ICON_DIR = path.resolve(miaoPath, '../../Lotus-Plugin/nanoka-atlas-backend/gallery/gi')
const CHAR_DIR = miaoPath + '/resources/meta-gs/character'
// 远程图标落盘缓存（渲染用 file:// 加载，避免远程图片未加载完就截图的竞态）
const ICON_CACHE_DIR = path.join(os.tmpdir(), 'endgame-icon-cache')

// nanoka rolecombat 元素 id → 元素（其前端 ze[id-1]：2火 3水 4草 5雷 6冰 7风 8岩；0/1 过滤）
const RC_ELEM = { 2: ['pyro', '火'], 3: ['hydro', '水'], 4: ['dendro', '草'], 5: ['electro', '雷'], 6: ['cryo', '冰'], 7: ['anemo', '风'], 8: ['geo', '岩'] }

// 幽境图标缺失时占位块的元素色（冰/风/火）
const ELEM_FALLBACK = ['cryo', 'anemo', 'pyro']
const ELEM_NAME = ['冰', '风', '火']

// 深渊下期正式服时间兜底（nanoka 测试服时间不可用；正式时间来自官方 7.1 版本活动快报）
const TOWER_TIME_FALLBACK = {
  '20098': { start: '2026-11-01 04:00:00', end: '2026-11-16 03:59:59' }
}

// ------------------------------------------------------------------ 缓存与抓取
const _cache = new Map()
const cacheGet = (key, ttl) => {
  const c = _cache.get(key)
  if (c && Date.now() - c.t < ttl) return c.data
  return null
}
const cacheSet = (key, data) => _cache.set(key, { t: Date.now(), data })

// 代理回退：直连失败时用本机代理（env 代理 → Clash 默认端口），undici 从 Yunzai 的 .pnpm 目录探测加载
let _proxyDispatcher
const getProxyDispatcher = () => {
  if (_proxyDispatcher !== undefined) return _proxyDispatcher
  _proxyDispatcher = null
  const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7890'
  try {
    const pnpmDir = miaoPath + '/../../node_modules/.pnpm'
    const dirs = fs.readdirSync(pnpmDir).filter(d => d.startsWith('undici@')).sort()
    if (dirs.length) {
      const undici = require(path.join(pnpmDir, dirs.pop(), 'node_modules/undici'))
      _proxyDispatcher = new undici.ProxyAgent(proxyUrl)
      logger.mark(`[endgame-info] 使用代理 ${proxyUrl}`)
    }
  } catch (e) {
    _proxyDispatcher = null
  }
  return _proxyDispatcher
}

const fetchJson = async (url, ttl = 30 * 60 * 1000) => {
  const hit = cacheGet(url, ttl)
  if (hit) return hit
  const opts = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
  let resp
  try {
    resp = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) })
  } catch (err) {
    const dispatcher = getProxyDispatcher()
    if (!dispatcher) throw err
    resp = await fetch(url, { ...opts, dispatcher, signal: AbortSignal.timeout(20000) })
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const data = await resp.json()
  cacheSet(url, data)
  return data
}

const getVersion = async () => (await fetchJson(`${BASE}/manifest.json`, 60 * 60 * 1000)).gi.latest
const getList = async (mode) => fetchJson(`${BASE}/gi/${await getVersion()}/${mode}.json`)
const getDetail = async (mode, id) => fetchJson(`${BASE}/gi/${await getVersion()}/zh/${mode}/${id}.json`)

// live 期 = live_begin ∈ [begin, end]
// 预告期 = 优先取 live_begin 在未来中最早的那个（如剧诗 31/32 同时在列时取 31）；否则（仅测试期数据，如幽境）退回 id 最大的
const pick = (list) => {
  const now = Date.now()
  const entries = Object.entries(list).map(([id, e]) => ({ id, ...e }))
  const live = entries.find(e => e.live_begin && new Date(e.live_begin.replace(' ', 'T')) <= now && now < new Date(e.live_end.replace(' ', 'T')))
  const ts = (e) => e.live_begin ? new Date(e.live_begin.replace(' ', 'T')).getTime() : null
  const future = entries.filter(e => ts(e) && ts(e) > now).sort((a, b) => ts(a) - ts(b))
  const beta = entries.filter(e => !ts(e)).sort((a, b) => Number(b.id) - Number(a.id))
  const next = future[0] || beta[0]
  return { live, next }
}

// ------------------------------------------------------------------ 图标与文本
// 本地（Lotus 图库）优先；无本地时返回远程候选 URL（不保证存在）
const resolveIconLocal = (name) => {
  if (!name) return ''
  for (const ext of ['.webp', '.png']) {
    const f = path.join(ICON_DIR, name + ext)
    if (fs.existsSync(f) && fs.statSync(f).size > 0) return `file:///${ICON_DIR.replace(/\\/g, '/')}/${name}${ext}`
  }
  return ''
}

const resolveIcon = (name) => resolveIconLocal(name) || (name ? `${BASE}/assets/gi/${name}.webp` : '')

// 远程 404 探测缓存：确认缺失的图标直接回退模板占位块，避免渲染出空图块
const _iconMiss = new Map()
const ICON_MISS_TTL = 24 * 3600 * 1000

const fileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/')

// 下载远程图标到本地缓存并返回 file:// URL；失败返回 ''（模板回退占位块）
const downloadIcon = async (name) => {
  const file = path.join(ICON_CACHE_DIR, name + '.webp')
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fileUrl(file)
  const opts = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, signal: AbortSignal.timeout(20000) }
  let resp
  try {
    resp = await fetch(`${BASE}/assets/gi/${name}.webp`, opts)
  } catch (err) {
    const dispatcher = getProxyDispatcher()
    if (!dispatcher) throw err
    resp = await fetch(`${BASE}/assets/gi/${name}.webp`, { ...opts, dispatcher })
  }
  if (!resp.ok) return ''
  const buf = Buffer.from(await resp.arrayBuffer())
  fs.mkdirSync(ICON_CACHE_DIR, { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, file)
  return fileUrl(file)
}

const resolveIconOk = async (name) => {
  const local = resolveIconLocal(name)
  if (local) return local
  if (!name) return ''
  const hit = _iconMiss.get(name)
  if (hit && Date.now() - hit < ICON_MISS_TTL) return ''
  try {
    const url = await downloadIcon(name)
    if (url) return url
  } catch (err) {
    logger.warn(`[endgame-info] 图标下载失败，使用占位：${name} (${err.message})`)
  }
  _iconMiss.set(name, Date.now())
  logger.mark(`[endgame-info] 图标缺失，使用占位：${name}`)
  return ''
}

const cleanTag = (t) => (t || '')
  .replace(/\{SPRITE_PRESET#\d+\}/g, '')
  .replace(/<\/?Color[^>]*>/g, '')
  .replace(/<\/?color[^>]*>/g, '')
  .trim()

// nanoka 文本：字面 "\n" 分段；<color=#xxx> → span 着色
const cleanDesc = (s) => String(s || '')
  .replace(/\{SPRITE_PRESET#\d+\}/g, '')
  .split('\\n')
  .map(t => t.trim())
  .filter(Boolean)
  .map(t => t.replace(/<color=#([0-9a-fA-F]{6,8})>/g, '<span style="color:#$1">').replace(/<\/color>/g, '</span>'))

// ------------------------------------------------------------------ 角色元数据（剧诗开幕/特邀）
let _charMeta = null
const charMeta = (id) => {
  if (!_charMeta) {
    try {
      _charMeta = JSON.parse(fs.readFileSync(CHAR_DIR + '/data.json', 'utf8'))
    } catch (e) {
      _charMeta = {}
    }
  }
  return _charMeta[String(id)] || { name: `角色${id}`, elem: '' }
}

const avatarChip = (id) => {
  const meta = charMeta(id)
  const faceDir = `${CHAR_DIR}/${meta.name}/imgs`
  let face = ''
  for (const ext of ['face.webp', 'face.png']) {
    const f = path.join(faceDir, ext)
    if (fs.existsSync(f) && fs.statSync(f).size > 0) {
      face = `file:///${faceDir.replace(/\\/g, '/')}/${ext}`
      break
    }
  }
  return { name: meta.name, elem: meta.elem, face }
}

// ------------------------------------------------------------------ 三种信息卡数据组装
// 幽境危战（hard-info 模板）
const buildHard = async (id, listEntry) => {
  const raw = await getDetail('leyline', id)
  const lv = raw.level
  const diffKey = Object.keys(lv).find(k => lv[k].difficulty_config.name === '绝境') || Object.keys(lv).pop()
  const diff = lv[diffKey]
  return {
    template: 'stat/hard-info',
    renderData: {
      info: {
        ...statusOf(listEntry),
        scheduleId: String(raw.id),
        name: raw.name,
        start: (listEntry && listEntry.live_begin) || raw.begin_time,
        end: (listEntry && listEntry.live_end) || raw.end_time,
        difficulty: diff.difficulty_config.level,
        difficultyName: diff.difficulty_config.name,
        // nanoka 的 monster_level 是配置值，游戏内显示 = 配置值+1（官方百科逐档实证）
        level: diff.monster_level + 1,
        desc: diff.difficulty_config.desc_list || [],
        challs: await Promise.all(Object.entries(diff.level_config).map(async ([ck, c], i) => ({
          name: `第 ${i + 1} 场`,
          elem: ELEM_FALLBACK[i],
          elemName: ELEM_NAME[i],
          tags: (c.recommend_list || []).map(cleanTag).filter(Boolean),
          monster: {
            name: c.name,
            icon: await resolveIconOk(c.icon),
            shield: (c.monster_buff_name_list || []).join(' · '),
            desc: (c.monster_buff_detail_list && c.monster_buff_detail_list.length
              ? c.monster_buff_detail_list
              : c.monster_buff_desc_list || []
            ).map((d, j) => `<b>「${(c.monster_buff_name_list || [])[j] || ''}」</b>${d}`)
          }
        })))
      }
    }
  }
}

// 深境螺旋（tower-info 模板）
const buildTower = async (id, listEntry) => {
  const raw = await getDetail('tower', id)
  const useOfficialFallback = !(listEntry && listEntry.live_begin) && !!TOWER_TIME_FALLBACK[id]
  const t = (listEntry && listEntry.live_begin)
    ? { start: listEntry.live_begin, end: listEntry.live_end }
    : (TOWER_TIME_FALLBACK[id] || { start: raw.open, end: raw.close })
  const info = {
    ...statusOf(listEntry),
    // 官方兜底时间可信 → 档期标签从「测试服档期」改为「正式档期」
    timeLabel: useOfficialFallback ? '正式档期' : undefined,
    scheduleId: id,
    name: raw.leyline.name,
    start: t.start,
    end: t.end,
    floors: await Promise.all(Object.keys(raw.floor).sort((a, b) => a - b).map(async (fk) => {
      const f = raw.floor[fk]
      const rooms = await Promise.all(Object.keys(f.room).sort((a, b) => a - b).map(async (rk) => {
        const r = f.room[rk]
        return {
          no: rk,
          level: r.level,
          first: await Promise.all((r.first || []).map(async m => ({ name: m.name, level: m.level !== undefined ? m.level : r.level, icon: await resolveIconOk(m.icon) }))),
          second: await Promise.all((r.second || []).map(async m => ({ name: m.name, level: m.level !== undefined ? m.level : r.level, icon: await resolveIconOk(m.icon) })))
        }
      }))
      const empty = rooms.every(r => !r.first.length && !r.second.length)
      return { no: fk, buffs: (f.buff || []).map(b => b.replace('(test)', '测试：')), rooms, empty }
    }))
  }
  return {
    template: 'stat/tower-info',
    renderData: {
      info,
      blessing: {
        name: raw.leyline.name,
        desc: raw.leyline.desc,
        icon: await resolveIconOk(listEntry && listEntry.icon)
      }
    }
  }
}

// 幻想真境剧诗（rolecombat-info 模板）
const buildRolecombat = async (id, listEntry) => {
  const raw = await getDetail('rolecombat', id)
  const dc = raw.difficulty_config
  const diffs = Object.keys(dc).sort((a, b) => a - b).map(k => {
    const v = dc[k]
    const nRoom = Object.keys(v.room || {}).length
    const nHard = Object.keys(v.hard_room || {}).length
    return { no: k, summary: `${nRoom} 幕${nHard ? ` + ${nHard} 圣牌` : ''}` }
  })
  // 难度5（幻想难度）全 12 关：第1~10幕 + 圣牌挑战×2
  // 普通幕无 title（敌人随机组合，数据仅等级）→ 紧凑 pill；Boss 幕/圣牌挑战 → 完整卡
  // monster_level 为配置值，显示 = 值+1（BWIKI 逐幕实证）
  const blocks = []
  let pills = []
  const flushPills = () => {
    if (pills.length) {
      blocks.push({ type: 'pills', acts: pills })
      pills = []
    }
  }
  const d5 = dc['5'] || dc[Object.keys(dc).pop()]
  for (const no of Object.keys(d5.room).sort((a, b) => a - b)) {
    const r = d5.room[no]
    if (!r.title) {
      pills.push({ no, level: r.monster_level + 1 })
      continue
    }
    flushPills()
    const previews = await Promise.all((r.monster_preview_list || []).map(async m => ({ name: m.name, icon: await resolveIconOk(m.icon) })))
    if (!previews.length) previews.push({ name: r.title, icon: '' })
    blocks.push({ type: 'stage', st: { no, label: `第 ${no} 幕`, level: r.monster_level + 1, title: r.title, hard: false, previews, desc: cleanDesc(r.desc) } })
  }
  flushPills()
  let hardIdx = 0
  for (const no of Object.keys(d5.hard_room || {}).sort((a, b) => a - b)) {
    const r = d5.hard_room[no]
    blocks.push({
      type: 'stage',
      st: {
        no,
        label: `圣牌挑战 ${++hardIdx}`, // 数据按幕位 4/7 键控，但实为独立挑战，与普通幕数字区分
        level: r.monster_level + 1,
        title: r.title,
        hard: true,
        previews: await Promise.all((r.monster_preview_list || []).map(async m => ({ name: m.name, icon: await resolveIconOk(m.icon) }))),
        desc: cleanDesc(r.desc)
      }
    })
  }
  const buffDescs = [...new Set((raw.avatar_config.buff_avatar_list || []).map(b => cleanDesc(b.desc)[0]).filter(Boolean))]
  const info = {
    ...statusOf(listEntry),
    scheduleId: id,
    start: (listEntry && listEntry.live_begin) || raw.begin_time,
    end: (listEntry && listEntry.live_end) || raw.end_time,
    elems: (raw.avatar_config.element_list || []).map(x => RC_ELEM[x]).filter(Boolean).map(([key, name]) => ({ key, name })),
    // 官方口径：buff_avatar_list(6人带幻境祝福) = 开幕角色；invite_avatar_list(4人) = 特邀角色
    kaimuAvatars: (raw.avatar_config.buff_avatar_list || []).map(b => avatarChip(b.id)),
    teyaoAvatars: (raw.avatar_config.invite_avatar_list || []).map(x => avatarChip(x)),
    buffDescs,
    diffs,
    blocks
  }
  return { template: 'stat/rolecombat-info', renderData: { info } }
}

// ------------------------------------------------------------------ 期次状态与档期标注
// status: live=进行中 / next=下期预告；beta=true 表示仅有测试服档期（live_begin 缺失）
// beta 期 raw 里的 begin/end 是测试服时间（常已过期），直接展示会误导 → 打「测试服档期」标签
const statusOf = (listEntry) => {
  const now = Date.now()
  const ts = (s) => (s ? new Date(String(s).replace(' ', 'T')).getTime() : null)
  const begin = ts(listEntry && listEntry.live_begin)
  const end = ts(listEntry && listEntry.live_end)
  const live = begin && begin <= now && (!end || now < end)
  return {
    status: live ? 'live' : 'next',
    beta: !begin,
    timeLabel: !begin ? '测试服档期' : (!live ? '正式档期' : '')
  }
}

const BUILDERS = { leyline: buildHard, tower: buildTower, rolecombat: buildRolecombat }

// 导出内部实现：供离线预览/自检脚本直接复用真实组装路径（.workbuddy/wave-render/render_endgame.mjs）
export { pick, statusOf, getList, getDetail, buildHard, buildTower, buildRolecombat, query, BUILDERS, resolveIcon, resolveIconOk }

// ------------------------------------------------------------------ 指令处理
const query = async (e, mode, useNext) => {
  try {
    const list = await getList(mode)
    const { live, next } = pick(list)
    const entry = useNext ? next : live
    if (!entry) return e.reply(useNext ? '暂未查到下一期数据，请稍后再试~' : '暂未找到进行中的期次~')
    const built = await BUILDERS[mode](entry.id, entry)
    if (useNext) await e.reply('下期预告 · 测试服数据，正式以游戏内为准')
    // 注意：runtime.render 默认 retType 会自行 e.reply 发送图片并返回 true，勿再包一层 e.reply
    return await Common.render(built.template, built.renderData, { e, scale: 1 })
  } catch (err) {
    console.error('endgame-info 查询失败:', err && err.message)
    return e.reply('信息卡数据获取失败，请稍后再试（数据源：nanoka.cc）')
  }
}

let app = App.init({
  id: 'endgame',
  name: '全境 Info',
  desc: '幽境危战/深渊/剧诗信息卡'
})

app.reg({
  hardInfo: {
    rule: /^#?幽境危战(?:信息预告|信息|预告)$/,
    fn: async function (e) { return query(e, 'leyline', e.msg.includes('预告')) },
    desc: '【#幽境危战信息/预告】'
  },
  towerInfo: {
    rule: /^#?(?:深境螺旋|深渊)(?:信息预告|信息|预告)$/,
    fn: async function (e) { return query(e, 'tower', e.msg.includes('预告')) },
    desc: '【#深渊信息/预告】'
  },
  rolecombatInfo: {
    rule: /^#?(?:幻想真境剧诗|剧诗)(?:信息预告|信息|预告)$/,
    fn: async function (e) { return query(e, 'rolecombat', e.msg.includes('预告')) },
    desc: '【#剧诗信息/预告】'
  }
})

export default app
