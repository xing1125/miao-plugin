// 离线渲染 幻想真境剧诗·期次信息卡（rolecombat-info）→ PNG
// 用法：node .workbuddy/wave-render/render_rolecombat_info.mjs [期号]   默认 31（下期）
// 数据：data/rolecombat-<id>.json（nanoka zh/rolecombat，阵容+难度+幕）
//       data/theater-next-<id>.json（DimbreathBot 推导，角色名/元素/正式服时间）
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '../..')
const RES = PLUGIN + '/resources'

const require = createRequire(import.meta.url)
const template = require('D:/yunzai-yingbot/Yunzai/app/node_modules/.pnpm/art-template@4.13.2/node_modules/art-template/index.js')
const puppeteer = (await import('file:///D:/yunzai-yingbot/Yunzai/app/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default

// ------------------------------------------------------------------ 配置
const SCHED_ID = process.argv[2] || '31'
const DATA_FILE = path.join(__dirname, `data/rolecombat-${SCHED_ID}.json`)
const NEXT_FILE = path.join(__dirname, `data/theater-next-${SCHED_ID}.json`)
const ICON_DIR = 'D:/yunzai-yingbot/Yunzai/app/plugins/Lotus-Plugin/nanoka-atlas-backend/gallery/gi'
const NANOKA_ASSET = (name) => `https://static.nanoka.cc/assets/gi/${name}.webp`

// nanoka rolecombat 元素 id → 元素（其前端 ze[id-1]：2火 3水 4草 5雷 6冰 7风 8岩；0/1 过滤）
const ELEM = { 2: ['pyro', '火'], 3: ['hydro', '水'], 4: ['dendro', '草'], 5: ['electro', '雷'], 6: ['cryo', '冰'], 7: ['anemo', '风'], 8: ['geo', '岩'] }

// ------------------------------------------------------------------ 工具
const localIcon = (name) => {
  if (!name) return ''
  for (const ext of ['.webp', '.png']) {
    const f = path.join(ICON_DIR, name + ext)
    if (fs.existsSync(f) && fs.statSync(f).size > 0) return `file:///${ICON_DIR.replace(/\\/g, '/')}/${name}${ext}`
  }
  return NANOKA_ASSET(name)
}

const avatarFace = (name) => {
  const dir = path.join(RES, 'meta-gs/character', name, 'imgs')
  for (const ext of ['face.webp', 'face.png']) {
    const f = path.join(dir, ext)
    if (fs.existsSync(f) && fs.statSync(f).size > 0) return `file:///${dir.replace(/\\/g, '/')}/${ext}`
  }
  return ''
}

// nanoka 文本：字面 "\n" 分段；<color=#xxx> → span 着色；去 {SPRITE_PRESET#N}
const cleanDesc = (s) => String(s || '')
  .replace(/\{SPRITE_PRESET#\d+\}/g, '')
  .split('\\n')
  .map(t => t.trim())
  .filter(Boolean)
  .map(t => t.replace(/<color=#([0-9a-fA-F]{6,8})>/g, '<span style="color:#$1">').replace(/<\/color>/g, '</span>'))

// ------------------------------------------------------------------ 组装数据
const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
const next = JSON.parse(fs.readFileSync(NEXT_FILE, 'utf8'))

const avatarChip = (av) => ({
  name: av.name,
  elem: av.elem,
  face: avatarFace(av.name)
})

const dc = raw.difficulty_config
const diffs = Object.keys(dc).sort((a, b) => a - b).map(k => {
  const v = dc[k]
  const nRoom = Object.keys(v.room || {}).length
  const nHard = Object.keys(v.hard_room || {}).length
  return { no: k, summary: `${nRoom} 幕${nHard ? ` + ${nHard} 艰苦` : ''}` }
})

// 难度 5（幻想难度）全部 12 关：第 1~10 幕 + 圣牌挑战 ×2
// 普通幕无 title（敌人为随机组合，数据仅等级）→ 紧凑 pill；Boss 幕/圣牌挑战 → 完整卡
// ⚠️ nanoka 的 monster_level 是配置值，游戏内显示 = 值+1（BWIKI 第十八期实证：89→90/91→92/94→95/99→100）
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
  const previews = (r.monster_preview_list || []).map(m => ({ name: m.name, icon: localIcon(m.icon) }))
  if (!previews.length) previews.push({ name: r.title, icon: '' }) // 预览缺失 → 占位 chip（如「历经百战的丘丘萨满」）
  blocks.push({
    type: 'stage',
    st: {
      no,
      label: `第 ${no} 幕`,
      level: r.monster_level + 1,
      title: r.title,
      hard: false,
      previews,
      desc: cleanDesc(r.desc)
    }
  })
}
flushPills()
let hardIdx = 0
for (const no of Object.keys(d5.hard_room || {}).sort((a, b) => a - b)) {
  const r = d5.hard_room[no]
  blocks.push({
    type: 'stage',
    st: {
      no,
      label: `圣牌挑战 ${++hardIdx}`, // 与普通幕数字区分（数据按幕位 4/7 键控，但实为独立挑战）
      level: r.monster_level + 1,
      title: r.title,
      hard: true,
      previews: (r.monster_preview_list || []).map(m => ({ name: m.name, icon: localIcon(m.icon) })),
      desc: cleanDesc(r.desc)
    }
  })
}

const buffDescs = [...new Set((raw.avatar_config.buff_avatar_list || []).map(b => cleanDesc(b.desc)[0]).filter(Boolean))]

const info = {
  scheduleId: SCHED_ID,
  start: next.start,
  end: next.end,
  elems: (raw.avatar_config.element_list || []).map(id => ELEM[id]).filter(Boolean).map(([key, name]) => ({ key, name })),
  // 官方口径（7.1 公告实证）：buff_avatar_list(6人带幻境祝福) = 开幕角色；invite_avatar_list(4人) = 特邀角色（不受元素限制）
  kaimuAvatars: next.guestAvatars.map(avatarChip),
  teyaoAvatars: next.openAvatars.map(avatarChip),
  buffDescs,
  diffs,
  blocks
}

// ------------------------------------------------------------------ 渲染
const RES_URL = 'file:///' + RES.replace(/\\/g, '/')
const tplPath = RES + '/stat/rolecombat-info.html'
const renderData = {
  _miao_path: RES_URL + '/',
  _res_path: RES_URL,
  defaultLayout: RES + '/common/layout/default.html',
  elemLayout: RES + '/common/layout/elem.html',
  sys: { scale: 'style=transform:scale(1)' },
  copyright: 'Created By Yunzai-Bot<span class="version">v3.1.3</span> & Miao-Plugin<span class="version">2.5.20</span>',
  game: 'gs',
  uid: '100000000',
  info
}

console.log('[1/3] render template')
const html = template.render(fs.readFileSync(tplPath, 'utf8'), renderData, { filename: tplPath })
const outDir = path.join(__dirname, 'out')
fs.mkdirSync(outDir, { recursive: true })
const htmlPath = path.join(outDir, 'rolecombat-info.html')
fs.writeFileSync(htmlPath, html)

console.log('[2/3] launch chrome')
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--font-render-hinting=none']
})
const page = await browser.newPage()
await page.setViewport({ width: 975, height: 1400, deviceScaleFactor: 2 })
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'networkidle0', timeout: 60000 })
await new Promise((r) => setTimeout(r, 800))

console.log('[3/3] screenshot')
const el = await page.$('.container')
await el.screenshot({ path: path.join(outDir, `rolecombat-info-${SCHED_ID}.png`) })
console.log('完成：' + path.join(outDir, `rolecombat-info-${SCHED_ID}.png`))
await browser.close()
