import lodash from 'lodash'
import { getTargetUid, getProfileRefresh } from './ProfileCommon.js'
import ProfileList from './ProfileList.js'
import { Cfg, Common, Data, Format } from '#miao'
import { Button, MysApi, ProfileRank, Character, Weapon, Artifact } from '#miao.models'
import ProfileChange from './ProfileChange.js'
import { profileArtis } from './ProfileArtis.js'
import { ProfileWeapon } from './ProfileWeapon.js'

let { diyCfg } = await Data.importCfg('profile')
let profile = false
// 查看当前角色
let ProfileDetail = {
  async detail (e) {
    let msg = e.original_msg || e.msg
    if (!msg) {
      return false
    }
    if (!/详细|详情|面板|面版|圣遗物|遗器|伤害|武器|换/.test(msg)) {
      return false
    }
    let mode = 'profile'
    let profileChange = false
    let changeMsg = msg
    let pc = ProfileChange.matchMsg(msg)
    if (pc && pc.char && pc.change) {
      if (!Cfg.get('profileChange')) {
        e.reply('面板替换功能已禁用...')
        return true
      }
      e.game = pc.game
      e.isSr = e.game === 'sr'
      e.uid = ''
      e.msg = '#喵喵面板变换'
      e.uid = pc.uid || await getTargetUid(e)
      profileChange = ProfileChange.getProfile(e.uid, pc.char, pc.change, pc.game)
      if (profileChange && profileChange.char) {
        msg = `#${profileChange.char?.name}${pc.mode || '面板'}`
        e._profile = profileChange
        e._profileMsg = changeMsg
      }
    }
    let uidRet = /(18|[1-9])[0-9]{8}/g.exec(msg)
    if (uidRet) {
      e.uid = uidRet[0]
      msg = msg.replace(uidRet[0], '')
    }

    let name = msg.replace(/#|老婆|老公|星铁|原神/g, '').trim()
    msg = msg.replace('面版', '面板')
    let dmgRet = /(?:伤害|武器)(\d*)$/.exec(name)
    let dmgIdx = 0; let idxIsInput = false
    if (/(最强|最高|最高分|最牛|第一)/.test(msg)) {
      mode = /(分|圣遗物|遗器|评分|ACE)/.test(msg) ? 'rank-mark' : 'rank-dmg'
      name = name.replace(/(最强|最高分|第一|最高|最牛|圣遗物|遗器|评分|群)/g, '')
    }
    if (/(详情|详细|面板|面版)\s*$/.test(msg) && !/更新|录入|输入/.test(msg)) {
      mode = 'profile'
      name = name.replace(/(详情|详细|面板)/, '').trim()
    } else if (dmgRet) {
      // mode = /武器/.test(msg) ? 'weapon' : 'dmg'
      mode = 'dmg'
      name = name.replace(/(伤害|武器)+\d*/, '').trim()
      if (dmgRet[1]) {
        dmgIdx = dmgRet[1] * 1
        // 标识是用户指定的序号
        idxIsInput = true
      }
    } else if (/(详情|详细|面板)更新$/.test(msg) || (/更新/.test(msg) && /(详情|详细|面板)$/.test(msg))) {
      mode = 'refresh'
      name = name.replace(/详情|详细|面板|更新/g, '').trim()
    } else if (/圣遗物|遗器/.test(msg)) {
      mode = 'artis'
      name = name.replace(/圣遗物|遗器/, '').trim()
    }
    if (!Common.cfg('avatarProfile')) {
      return false // 面板开关关闭
    }
    let char = Character.get(name.trim(), e.game)
    if (!char) {
      return false
    }
    if (/星铁/.test(msg) || char.isSr) {
      e.game = 'sr'
      e.isSr = true
    }

    let uid = e.uid || await getTargetUid(e)
    if (!uid) {
      return true
    }
    e.uid = uid
    e.avatar = char.id

    if (char.isCustom) {
      e.reply('自定义角色暂不支持此功能')
      return true
    }
    if (!char.isRelease) {
      // 预设面板支持未实装角色
      if (!profileChange && Number(e.uid) > 100000006) {
        e.reply('角色尚未实装')
        return true
      }
      // 但仅在未实装开启时展示
      if (Cfg.get('notReleasedData') === false) {
        e.reply('未实装角色面板已禁用...')
        return true
      }
    }

    if (mode === 'profile' || mode === 'dmg' || mode === 'weapon') {
      return ProfileDetail.render(e, char, mode, { dmgIdx, idxIsInput })
    } else if (mode === 'refresh') {
      await ProfileList.refresh(e)
      return true
    } else if (mode === 'artis') {
      return profileArtis(e)
    }
    return true
  },

  async render (e, char, mode = 'profile', params = {}) {
    let selfUser = await MysApi.initUser(e)

    if (!selfUser) {
      e.reply(['尚未绑定UID', new Button(e).bindUid()])
      return true
    }

    let { uid } = e

    if (char.isCustom) {
      e.reply(`暂不支持自定义角色${char.name}的面板信息查看`)
      return true
    }

    let profile = e._profile || await getProfileRefresh(e, char.id)
    if (!profile) {
      return true
    }
    profile.uid = e.uid
    char = profile.char || char
    let a = profile.attr
    let base = profile.base
    let attr = {}
    let game = char.game
    let isGs = game === 'gs'
    let isSr = !isGs

    lodash.forEach((isGs ? 'hp,def,atk,mastery' : 'hp,def,atk,speed').split(','), (key) => {
      let fn = (n) => Format.comma(n, key === 'hp' ? 0 : 1)
      attr[key] = fn(a[key])
      attr[`${key}Base`] = fn(base[key])
      attr[`${key}Plus`] = fn(a[key] - base[key])
    })
    lodash.forEach((isGs ? 'cpct,cdmg,recharge,dmg' : 'cpct,cdmg,recharge,dmg,effPct,effDef,heal,stance,joy').split(','), (key) => {
      let fn = Format.pct
      let key2 = key
      if (key === 'dmg') {
        if (isGs) {
          if (a.phy > a.dmg) {
            key2 = 'phy'
          }
        }
      }
      attr[key] = fn(a[key2])
      attr[`${key}Base`] = fn(base[key2])
      attr[`${key}Plus`] = fn(a[key2] - base[key2])
    })

    let weapon = Weapon.get(profile?.weapon?.name, game)
    let w = profile.weapon
    let wCfg = {}
    if (mode === 'weapon') {
      wCfg = weapon.calcAttr(w.level, w.promote)
      wCfg.weapons = await ProfileWeapon.calc(profile)
    }

    let enemyLv = isGs ? (await selfUser.getCfg('char.enemyLv', 103)) : 80
    let dmgCalc = await ProfileDetail.getProfileDmgCalc({ profile, enemyLv, mode, params })

    let rank = false
    if (e.group_id && !e._profile) {
      rank = await ProfileRank.create({ group: e.group_id, uid, qq: e.user_id })
      await rank.getRank(profile, true)
    }

    let artisDetail = profile.getArtisMark()
    // 处理一下allAttr，确保都有9个内容，以获得比较好展示效果
    let allAttr = profile.artis.getAllAttr() || []
    allAttr = lodash.slice(allAttr, 0, 9)
    for (let idx = allAttr.length; idx < 9; idx++) {
      allAttr[idx] = {}
    }
    artisDetail.allAttr = allAttr

    let artisKeyTitle = Artifact.getArtisKeyTitle(game)
    let data = profile.getData('name,abbr,cons,level,talent,dataSource,updateTime,imgs,costumeSplash')
    if (isSr) {
      let treeData = []
      let treeMap = {}
      // 属性
      lodash.forEach('0113355778'.split(''), (pos, idx) => {
        treeData[pos] = treeData[pos] || []
        let tmp = { type: 'tree', img: '/meta-sr/public/icons/tree-cpct.webp' }
        treeData[pos].push(tmp)
        treeMap[idx + 201 + ''] = tmp
      })
      // 属性建成后图标替换
      lodash.forEach(Object.keys(char.detail.tree), (id) => {
        let ret = /([12][01][0-9])$/.exec(id + '')
        if (ret && ret[1]) {
          let treeId = ret[1]
          if (treeId[0] === '2') {
            treeMap[treeId].img = `/meta-sr/public/icons/tree-${char.detail?.tree?.[id]?.key}.webp`
          }
        }
      })
      // 能力
      lodash.forEach([2, 4, 6], (pos, idx) => {
        let tmp = { type: 'talent', img: data.imgs[`tree${idx + 1}`] }
        treeData[pos] = tmp
        treeMap[idx + 101 + ''] = tmp
      })
      // 点亮图标
      lodash.forEach(profile.trees, (id) => {
        let ret = /([12][01][0-9])$/.exec(id + '')
        if (ret && ret[1]) {
          let treeId = ret[1]
          if (treeMap?.[treeId]) {
            treeMap[treeId].value = 1
          }
        }
      })
      data.treeData = treeData
    }
    data.weapon = profile.getWeaponDetail()

    // 卡片式布局（profile-detail-wave）：原神 + 星铁的 profile 模式都走新模板。
    // 星铁遗器 6 件正好占满 3×2 网格，评分卡（rscore）仅原神渲染（用户拍板：星铁不需要评分模块）
    let charCard = ProfileDetail.getCardData({ char, data, attr, artisDetail, dmgCalc, game, artisKeyTitle })
    let tplFile = ((game === 'gs' || game === 'sr') && mode === 'profile')
      ? 'character/profile-detail-wave'
      : 'character/profile-detail'

    let renderData = {
      save_id: uid,
      uid,
      game,
      data,
      attr,
      elem: char.elem,
      hsr_paths: char.weapon,
      dmgCalc,
      artisDetail,
      artisKeyTitle,
      charCard,
      bodyClass: `char-${char.name}`,
      mode,
      wCfg,
      changeProfile: e._profileMsg
    }
    // 渲染图像
    const msgRes = await e.reply([await Common.render(tplFile, renderData, { e, scale: 1.6, retType: 'base64' }), new Button(e).profile(char, uid)])
    if (msgRes) {
      // 如果消息发送成功，就将message_id和图片路径存起来，3小时过期
      const message_id = [e.message_id]
      if (Array.isArray(msgRes.message_id)) {
        message_id.push(...msgRes.message_id)
      } else {
        message_id.push(msgRes.message_id)
      }
      for (const i of message_id) {
        await redis.set(`miao:original-picture:${i}`, JSON.stringify({
          type: 'profile',
          img: renderData?.data?.costumeSplash
        }), { EX: 3600 * 3 })
      }
    }
    return true
  },

  /**
   * 卡片式面板（profile-detail-wave）所需的派生字段
   * 全部由现有 profile 数据算出，不改动 models —— 只在这里做换算
   */
  getCardData ({ char, data, attr, artisDetail, dmgCalc, game, artisKeyTitle }) {
    let ad = artisDetail || {}
    let isGs = game === 'gs'
    let imgs = data?.imgs || {}
    let weapon = data?.weapon || {}

    // ---- 圣遗物逐件（ad.artis 以 0..n 为 key）
    let items = []
    lodash.forEach(ad.artis, (ds, idx) => {
      if (ds && ds.mark) {
        items.push({ idx: idx * 1, ...ds })
      }
    })
    let count = items.length
    let totalMark = ad._mark || 0
    let avgMark = count ? totalMark / count : 0
    let maxMark = count ? Math.max(...items.map((it) => it._mark || 0)) : 0
    let fullCount = isGs ? 5 : 6

    // ---- 有效词条判定 ----
    // 口径与 miao 自身一致（权重表 resources/meta-gs/artifact/artis-mark.js 的 usefulAttr，
    // 经 ArtisMarkCfg.getCfg() 洗成 ad.charWeight；权重 <=0 的词条根本不会进 charWeight）：
    //   1) 权重为 0（如玛薇卡的充能/防御/生命）或不在表内的 key，都算「无效词条」；
    //   2) 元素伤害加成在 attrMap 里统一记在 dmg 上（见 ArtisMark.formatArti 的 isElem 分支），
    //      而 allAttr 的 key 保留原元素名（pyro/hydro...），所以必须先归一化成 dmg 再查，
    //      否则属性伤害杯会被整片误判成无效；
    //   3) 小生命/小攻击/小防御按 attr.base 复用大词条权重（extra.js:67），故它们与对应大词条同判；
    //   4) charWeight 整体缺失时不做判定，避免把整块词条误压暗。
    let cw = ad.charWeight || {}
    let hasCw = Object.keys(cw).length > 0
    let isUseful = (key) => {
      if (!hasCw) {
        return true
      }
      let k = Format.isElem(key, game) && cw.dmg != null ? 'dmg' : key
      return (cw[k] || 0) > 0
    }

    // ---- 副词条等效词条总数（allAttr[].eff 已是格式化字符串）
    let effSum = 0
    lodash.forEach(ad.allAttr, (a) => {
      if (a && a.eff && a.eff !== '-') {
        effSum += parseFloat((a.eff + '').replace(/,/g, '')) || 0
      }
    })

    // ---- 有效词条展示口径：等效词条数（对齐两游戏小程序的显示习惯）
    //   小程序展示的「有效词条数」是等效折算值（副词条数值 ÷ 单条标准值），
    //   不是物理条数：原神（提瓦特小助手）取整显示；星铁（米游社社区口径）
    //   显示一位小数，且速度/充能不参与词条计量（配速优先，无法量化）。
    //   allAttr[].eff 就是 miao 自己算好的等效词条数，按 isUseful 过滤求和即可。
    let usefulEff = 0
    lodash.forEach(ad.allAttr, (a) => {
      if (a && a.key && a.eff && a.eff !== '-' && isUseful(a.key)) {
        if (!isGs && (a.key === 'speed' || a.key === 'recharge')) {
          return
        }
        usefulEff += parseFloat((a.eff + '').replace(/,/g, '')) || 0
      }
    })
    // 原神取整显示（提瓦特小助手习惯）；星铁固定一位小数（米游社口径）
    usefulEff = isGs ? String(Math.round(usefulEff)) : (Math.round(usefulEff * 10) / 10).toFixed(1)
    // 进度条：有效等效 / 总等效 的占比（总等效含速度/充能，占比略保守，无碍观感）
    let usefulPct = effSum ? Math.max(0, Math.min(100, Math.round(usefulEff / effSum * 100))) : 0

    // ---- 副词条物理条数（逐条口径，备用参考值，模板当前不展示）
    let subUseful = 0
    let subTotal = 0
    lodash.forEach(ad.artis || {}, (ds) => {
      lodash.forEach(ds?.attrs || [], (a) => {
        if (a && a.key) {
          subTotal++
          if (isUseful(a.key)) {
            subUseful++
          }
        }
      })
    })
    let usefulCount = subUseful
    let affixTotal = subTotal

    // ---- 评级配色（六格评分卡与圣遗物卡共用）
    // 评级配色：MAX / ACE 统一走红色系，靠「高亮强度」拉开档次（与本地 .mark-MAX/.mark-ACE 口径对齐）。
    //   色值：MAX #FF4D4F（亮红，最高亮）/ ACE #FF3B30（正红，压一档）
    //   详细差异（字重、发光强度、底色浓度）在 profile-detail-wave.css 的 .wv-grade-MAX / .wv-grade-ACE 里。
    let GRADE_HEX = { MAX: '#FF4D4F', ACE: '#FF3B30', SSS: '#62B4E8', SS: '#62D0B0', S: '#4BCB9A' }
    let GRADE_RGB = { MAX: '255,77,79', ACE: '255,59,48', SSS: '98,180,232', SS: '98,208,176', S: '75,203,154' }
    // 徽章底色浓度：MAX 稍实（.22）、ACE 淡一档（.14），其余同旧值。
    // 注意别调太高 —— 红字压在深红底上会互相糊掉，上一版 .30 就踩了这个坑，
    // MAX 的"更亮"主要交给 CSS 里的双层描边 + 强外发光去表达。
    let GRADE_ALPHA = { MAX: '.22', ACE: '.14' }
    // 只有 MAX / ACE 需要额外的高亮档位 class，其余评级不带 class
    let gradeStyle = (g) => ({
      color: GRADE_HEX[g] || '#8FA3BC',
      bg: `rgba(${GRADE_RGB[g] || '143,163,188'},${GRADE_ALPHA[g] || '.16'})`,
      cls: g === 'MAX' || g === 'ACE' ? `wv-grade-${g}` : ''
    })

    // 评分环渐变：MAX / ACE 跟着评级走红色系（否则环是紫色、徽章是红色，同一张卡会打架），
    // 其余评级保留原来的紫 → 金渐变。
    // MAX 的整条渐变刻意比 ACE 亮一档（起点接近浅红），配合 CSS 里的更粗环身 + 更强发光，
    // 保证 76px 的小环上两档也能一眼分出来。
    let RING_GRAD = {
      MAX: ['#FFB0A8', '#FF5B5B', '#D42E23'],
      ACE: ['#FF6A5E', '#E8362B', '#8E1F18']
    }
    let ringStops = RING_GRAD[ad.markClass] || ['#9C7BE0', '#C4A2FF', '#E9CF8E']

    // ---- 部位名：原神固定「花羽沙杯冠」，星铁为六件
    let SLOT = {
      gs: ['生之花', '死之羽', '时之沙', '空之杯', '理之冠'],
      sr: ['头部', '手部', '躯干', '脚部', '位面球', '连结绳']
    }
    let slots = SLOT[game] || SLOT.gs

    // ---- 评分卡：五个部位条
    let parts = items.map((it, i) => ({
      name: slots[i] || `#${i + 1}`,
      full: it.name,
      score: it.mark,
      color: gradeStyle(it.markClass).color,
      cls: gradeStyle(it.markClass).cls,
      pct: Math.max(4, Math.min(100, Math.round((it._mark || 0) / 60 * 100)))
    }))

    // ---- 评分卡：三块指标
    let rsMetrics = [
      { k: '词条', v: Format.comma(effSum, 1) },
      { k: '最高', v: Format.comma(maxMark, 1) },
      { k: '件数', v: `${count} / ${fullCount}` }
    ]

    // ---- 圣遗物卡（参考样式：等效词条数 + »强化标记 + 主词条绿色高亮）
    let relics = items.map((it) => {
      let g = gradeStyle(it.markClass)
      let subs = (it.attrs || []).filter((a) => a && a.key).map((a) => ({
        roll: a.upNum || '',
        // upCls → 老版 up-num-icon 精灵图档位（up-2..up-5；只强化 1 次按老版不显示箭头）
        upCls: a.upNum && a.upNum > 1 ? 'up-' + Math.min(a.upNum, 5) : '',
        // eff = miao ArtisAttr 算好的等效词条数（数值÷单条标准值），两游戏口径一致
        eq: a.eff && a.eff > 0 ? Format.comma(a.eff, 1) : '',
        name: artisKeyTitle?.[a.key] || a.key,
        value: '+' + (a.value || ''),
        useful: isUseful(a.key)
      }))
      return {
        icon: it.img,
        name: it.name,
        level: it.level,
        scoreNum: it.mark,
        grade: it.markClass,
        gradeColor: g.color,
        gradeBg: g.bg,
        gradeCls: g.cls,
        mainLabel: artisKeyTitle?.[it.main?.key] || it.main?.key || '',
        mainValue: '+' + (it.main?.value || ''),
        subs
      }
    })

    // ---- 词条网格（短名，与原面板一致的口径）
    let S_TITLE = {
      暴击率: '暴击', 暴击伤害: '爆伤', 充能效率: '充能', 元素精通: '精通',
      效果命中: '命中', 效果抵抗: '抵抗', 击破特攻: '击破',
      大生命: '生命', 大攻击: '攻击', 大防御: '防御',
      小生命: '生命', 小攻击: '攻击', 小防御: '防御'
    }
    let affixes = []
    lodash.forEach(ad.allAttr, (a) => {
      if (a && a.key && a.value) {
        let full = artisKeyTitle?.[a.key] || a.key
        let useful = isUseful(a.key)
        // 注意：usefulCount/affixTotal 已改为「按副词条逐条计」（见上方 subUseful/subTotal），
        // 这里只是 9 行聚合视图的展示，不要再累加统计值
        affixes.push({
          n: a.eff && a.eff !== '-' ? a.eff : '',
          k: S_TITLE[full] || full,
          v: '+' + a.value,
          useful
        })
      }
    })

    // usefulPct 已在上方按「有效等效 / 总等效」计算（小程序口径），此处不再重复声明
    // hasCw=false（权重表整体缺失）时不展示「有效词条」，避免把整块词条标成无效造成误导
    let showUseful = hasCw && affixTotal > 0

    // ---- 套装名
    let setNames = lodash.isArray(ad.names) ? ad.names.filter((n) => n) : []
    // 星铁的「圣遗物」叫「遗器」（用户口径），标签统一下发
    let artisName = isGs ? '圣遗物' : '遗器'
    let relicSet = `${setNames.join(' · ') || artisName} · ${count} 件套`

    // ---- 属性表（三列：基础 / 加成 / 合计）
    let attrMap = isGs
      ? { hp: '生命值', atk: '攻击力', def: '防御力', mastery: '元素精通', cpct: '暴击率', cdmg: '暴击伤害', recharge: '元素充能', dmg: '伤害加成' }
      : {
          hp: '生命值', atk: '攻击力', def: '防御力', speed: '速度', cpct: '暴击率', cdmg: '暴击伤害',
          dmg: '伤害加成', stance: '击破特攻', effPct: '效果命中', effDef: '效果抵抗', heal: '治疗加成', joy: '欢愉度'
        }
    let stats = lodash.map(attrMap, (name, key) => ({
      key,
      name,
      base: attr?.[key + 'Base'] ?? '-',
      plus: '+' + (attr?.[key + 'Plus'] ?? '0'),
      total: attr?.[key] ?? '-'
    }))

    // ---- 星铁行迹条：data.treeData 由 render() 构建（10 个属性点 + 3 个大行迹交替，
    //      value=1 为点亮；属性点是数组组、大行迹是单对象）。这里归一化成模板友好结构
    let traces = []
    if (!isGs && data?.treeData) {
      lodash.forEach(data.treeData, (node) => {
        if (!node) {
          return
        }
        let arr = lodash.isArray(node) ? node : [node]
        traces.push({
          major: arr[0]?.type === 'talent',
          icons: arr.map((n) => ({ img: n.img, on: !!n.value }))
        })
      })
    }

    // ---- 命座/星魂轨迹（几命点亮几个；图标直接用上游 getImgs 的 cons1~cons6）
    let cons = data?.cons * 1 || 0
    let consLabel = isGs
      ? (['零命', '一命', '二命', '三命', '四命', '五命', '六命'][cons] || `${cons}命`)
      : (['零魂', '一魂', '二魂', '三魂', '四魂', '五魂', '六魂'][cons] || `${cons}魂`)
    let consNodes = [1, 2, 3, 4, 5, 6].map((i) => ({
      num: i,
      on: i <= cons,
      img: imgs[`cons${i}`] || ''
    }))

    // ---- 天赋单元（含练度条，口径：原神满 13 / 星铁满 15）
    let TALENT_STYLE = [
      { color: '#E9CF8E', line: 'rgba(233,207,142,.5)', glow: 'rgba(233,207,142,.5)', bg: 'linear-gradient(180deg,#292619,#12110D)' },
      { color: '#62D0B0', line: 'rgba(98,208,176,.5)', glow: 'rgba(98,208,176,.5)', bg: 'linear-gradient(180deg,#1A2E29,#0D1714)' },
      { color: '#E0604F', line: 'rgba(224,96,79,.5)', glow: 'rgba(224,96,79,.5)', bg: 'linear-gradient(180deg,#331C1A,#170D0D)' }
    ]
    // 星铁按命途补齐天赋键位（与旧模板口径一致）：
    //   记忆 → 忆灵技 me / 忆灵天赋 mt；欢愉 → 欢愉技 xe；其余命途 4 个。
    //   e2/t2/me2/mt1/mt2 是强化态，旧模板同样不展示。
    let srTalentMap = char?.weapon === '记忆'
      ? [['a', '普攻'], ['e', '战技'], ['t', '天赋'], ['q', '爆发'], ['me', '忆灵技'], ['mt', '忆灵天赋']]
      : (char?.weapon === '欢愉'
        ? [['a', '普攻'], ['e', '战技'], ['t', '天赋'], ['q', '爆发'], ['xe', '欢愉技']]
        : [['a', '普攻'], ['e', '战技'], ['t', '天赋'], ['q', '爆发']])
    let talentMap = isGs
      ? [['a', '普通攻击'], ['e', '元素战技'], ['q', '元素爆发']]
      : srTalentMap
    let talentMax = isGs ? 13 : 15
    let talents = talentMap.map(([key, name], i) => {
      let lv = (data?.talent?.[key]?.level ?? 0) * 1
      return {
        key,
        name,
        level: lv,
        pct: Math.max(3, Math.min(100, Math.round(lv / talentMax * 100))),
        img: imgs[key] || '',
        ...TALENT_STYLE[i % TALENT_STYLE.length]
      }
    })

    // ---- 武器面板
    let WPN_TITLE = {
      atkPct: '攻击', mastery: '精通', dmg: '伤害', hpPct: '生命', defPct: '防御',
      cpct: '暴击', cdmg: '爆伤', phy: '物伤', recharge: '充能', heal: '治疗', shield: '护盾'
    }
    let wpnStats = []
    if (isGs) {
      if (weapon.attrs?.atkBase) {
        wpnStats.push({ k: '基础攻击力', v: weapon.attrs.atkBase })
      }
      lodash.forEach(weapon.attrs, (v, k) => {
        if (k !== 'atkBase') {
          wpnStats.push({ k: WPN_TITLE[k] || k, v: '+' + v })
        }
      })
    } else {
      let SR_WPN = { hp: '生命', atk: '攻击', def: '防御' }
      lodash.forEach(weapon.attrs, (v, k) => {
        wpnStats.push({ k: SR_WPN[k] || k, v })
      })
    }

    // ---- 武器 meta 补充信息 ----
    // getWeaponDetail() 只导出 sName/splash/attrs/desc，等级上限、精炼上限、被动名要回查 meta
    let wpnMaxLv = ''
    let wpnMaxAffix = ''
    let wpnAffixTitle = ''
    if (weapon?.name) {
      // 先按 id 查，查不到再退回按名字查（不同数据源的 uid/id 口径不完全一致）
      let wRef = (weapon.id ? Weapon.get(weapon.id, game) : null) || Weapon.get(weapon.name, game)
      if (wRef) {
        wpnMaxLv = wRef.maxLv || ''
        wpnMaxAffix = wRef.maxAffix || ''
        wpnAffixTitle = wRef.detail?.affixTitle || ''
      }
    }

    // ---- 伤害表总计
    let dmgTotal = false
    if (dmgCalc?.dmgData?.length) {
      let sumDmg = 0
      let sumAvg = 0
      let hasTotal = false
      lodash.forEach(dmgCalc.dmgData, (dg) => {
        let d = parseFloat((dg.dmg + '').replace(/,/g, ''))
        let a = parseFloat((dg.avg + '').replace(/,/g, ''))
        if (!isNaN(d)) { sumDmg += d; hasTotal = true }
        if (!isNaN(a)) { sumAvg += a; hasTotal = true }
      })
      if (hasTotal) {
        dmgTotal = { dmg: Format.comma(sumDmg, 0), avg: Format.comma(sumAvg, 0) }
      }
    }

    // ---- 说明
    // 说明行里的评级词（ACE / MAX）单独切成片段上色，这样"（ACE：220 ~ 280 / MAX：280 以上）"
    // 这种区间说明也能一眼分出两档 —— 只给 MAX/ACE 挂 class，与徽章共用同一套 wv-grade-* 口径。
    let splitGrade = (s) => {
      s = s || ''
      let re = /(MAX|ACE|SSS|SS|S|A|B|C|D)/g
      let isWord = (c) => !!c && /[0-9A-Za-z]/.test(c)
      let out = []
      let last = 0
      let m
      while ((m = re.exec(s))) {
        // 词边界检查：避免把 "Sya" 之类的字母串里的 S 也切成评级
        if (isWord(s[m.index - 1]) || isWord(s[m.index + m[1].length])) {
          continue
        }
        if (m.index > last) {
          out.push({ t: s.slice(last, m.index) })
        }
        out.push({
          t: m[1],
          cls: m[1] === 'MAX' || m[1] === 'ACE' ? `wv-grade-${m[1]}` : ''
        })
        last = m.index + m[1].length
      }
      if (last < s.length) {
        out.push({ t: s.slice(last) })
      }
      return out.length ? out : [{ t: s }]
    }
    let { enemyLv, enemyName } = dmgCalc || {}
    let notes = []
    let addNote = (str) => notes.push({ segs: splitGrade(str) })
    if (enemyLv) {
      addNote(`目标为 ${enemyLv} 级${enemyName || '小宝'}，使用 #敌人等级${enemyLv} 命令可指定等级`)
    }
    addNote(`${artisName} ${count} 件，副词条按等效词条数计入评分（${ad.classTitle || '喵喵版规则'}）`)
    if (weapon?.name) {
      addNote(`武器 ${weapon.sName || weapon.name} ${isGs ? '精炼' : '叠影'} ${weapon.affix} 阶，武器被动加成已计入`)
    }
    addNote('伤害结果仅供配装参考，实际游戏情况更复杂')

    // 星铁元素是火/冰/雷/风/量子/虚数/物理，不带「元素」后缀；原神保持「X元素 · 命途」
    let SR_ELEM = { fire: '火', ice: '冰', wind: '风', lightning: '雷', quantum: '量子', imaginary: '虚数', physical: '物理' }
    let elemText = isGs
      ? `${char?.elem ? char.elem + '元素' : ''}${char?.weaponTypeName ? ' · ' + char.weaponTypeName : ''}`
      : `${SR_ELEM[char?.elem] || char?.elem || ''}${char?.weaponTypeName ? ' · ' + char.weaponTypeName : ''}`

    /* 元素符号 icon：用内联 SVG 绘制（miao 内无原神元素小图标资源，星铁虽有 webp 但两套不统一，
       自绘保证两游戏一致、清晰、且可用元素签名色做「鲜亮」点缀）。fill/stroke 走 currentColor，
       颜色由 style="color:xxx" 注入，模板直接 {{@card.elemIcon}} 展开即可。 */
    const ELEM_META = {
      pyro:     { c: '#FF6B3D', s: '<path d="M12 2.5C12 2.5 6.5 8.5 6.5 13a5.5 5.5 0 0 0 11 0c0-2-1-3.8-2-5.5 0 1.8-1.8 2.8-1.8 2.8s.8-4.3-1.7-8.3z"/>' },
      hydro:    { c: '#33A1FF', s: '<path d="M12 3C12 3 5.5 10.5 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10.5 12 3 12 3z"/>' },
      anemo:    { c: '#5FE3C4', s: '<path d="M12 3.5c4.2 0 7.5 3.3 7.5 7.5 0 1-1 2-2 2-1 0-2-1-2-2 0-2-1.7-3-3-3-3 0-5 2-5 5 0 3 2 5 5 5 1 0 2-1 2-2 0-1-1-2-2-2-2 0-3 1-3 3 0 4.2 3.3 7.5 7.5 7.5 5 0 9-4 9-9C21 7.7 17 3.5 12 3.5z"/>' },
      electro:  { c: '#C77DFF', s: '<path d="M12 2l7.5 7.5L12 12l4.5 4.5L12 22l-7.5-7.5L12 12 7.5 7.5z"/><path d="M12 6.5l2.8 3-2.8 1.4L9.2 9.5z"/>' },
      dendro:   { c: '#4FD66B', s: '<path d="M12 12c0-4.2-3-6.2-6.2-6.2 0 3.2 2 6.2 6.2 6.2zm0 0c0 4.2 3 6.2 6.2 6.2 0-3.2-2-6.2-6.2-6.2zm0 0c4.2 0 6.2 3 6.2 6.2 0-3.2-2-6.2-6.2-6.2zm0 0c-4.2 0-6.2-3-6.2-6.2 0 3.2 2 6.2 6.2 6.2z"/>' },
      cryo:     { c: '#7FD8FF', s: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17"/></g>' },
      geo:      { c: '#E6B23C', s: '<path d="M12 2l7 7-7 13L5 9z"/><path d="M5 9h14M12 2v20" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1"/>' },
      fire:     { c: '#FF7A33', s: '<path d="M12 2.5C12 2.5 6.5 8.5 6.5 13a5.5 5.5 0 0 0 11 0c0-2-1-3.8-2-5.5 0 1.8-1.8 2.8-1.8 2.8s.8-4.3-1.7-8.3z"/>' },
      ice:      { c: '#4FDDEE', s: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M20.7 7L3.3 17"/></g>' },
      wind:     { c: '#5FE3C4', s: '<path d="M12 3.5c4.2 0 7.5 3.3 7.5 7.5 0 1-1 2-2 2-1 0-2-1-2-2 0-2-1.7-3-3-3-3 0-5 2-5 5 0 3 2 5 5 5 1 0 2-1 2-2 0-1-1-2-2-2-2 0-3 1-3 3 0 4.2 3.3 7.5 7.5 7.5 5 0 9-4 9-9C21 7.7 17 3.5 12 3.5z"/>' },
      // 星铁元素键与上面 SR_ELEM 一致：fire/ice/wind/lightning/quantum/imaginary/physical
      // （elec/phy 是早期别名，保留兜底）
      lightning:{ c: '#FFD23F', s: '<path d="M13 2L5 13h5l-2 9 9-12h-5z"/>' },
      elec:     { c: '#FFD23F', s: '<path d="M13 2L5 13h5l-2 9 9-12h-5z"/>' },
      quantum:  { c: '#B98CFF', s: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3"/>' },
      imaginary:{ c: '#FF6BD0', s: '<path d="M12 3l9 9-9 9-9-9z"/><circle cx="12" cy="12" r="3.4"/>' },
      physical: { c: '#CFD8E2', s: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>' },
      phy:      { c: '#CFD8E2', s: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>' }
    }
    const em = ELEM_META[char.elem] || { c: '#9FB2C8', s: '<circle cx="12" cy="12" r="7"/>' }
    const elemIcon = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" style="color:${em.c}">${em.s}</svg>`
    const elemColor = em.c
    const elemTrait = char?.weaponTypeName ? ' · ' + char.weaponTypeName : ''

    // 游戏 logo：原神=派蒙 / 星铁=官方角色头像（取自 genshin 插件同名素材，已复制到
    // 本插件 common/cont/game-*.webp）。40px 徽章下小图标比字标（原神.png 白色字标）可辨识
    const gameLogo = isGs ? '/common/cont/game-gs.webp' : '/common/cont/game-sr.webp'
    // 武器类型图标：原神有 atk-{type}.webp（即 data.imgs.a）；星铁无对应素材 → 回退纯文本
    const wpnIcon = isGs && imgs?.a ? imgs.a : ''
    // 顶部信息条要和图标并排显示中文描述。
    // ⚠️ gs 的 char.elem 是英文 key（pyro），直接拼会输出「pyro元素」——必须走 Format.elemName 转「火」
    const elemLabel = char?.elem
      ? (isGs ? Format.elemName(char.elem) + '元素' : (SR_ELEM[char.elem] || char.elem) + '属性')
      : ''
    const wpnName = char?.weaponTypeName || ''

    return {
      elemText,
      elemIcon,
      elemColor,
      elemTrait,
      elemLabel,
      wpnName,
      gameLogo,
      wpnIcon,
      art: data?.costumeSplash || imgs.gacha || imgs.splash || '',
      wpnType: char?.weaponTypeName || '',
      wpnStars: lodash.times(weapon?.star || 5, (i) => i),
      wpnStats: wpnStats.slice(0, 4),
      wpnMaxLv,
      wpnMaxAffix,
      wpnAffixTitle,
      consNodes,
      consLabel,
      traces,
      talents,
      stats,
      scorePct: Math.max(0, Math.min(100, Math.round(avgMark / 60 * 100))),
      ringStops,
      artisName,
      relicCount: `${count} / ${fullCount}`,
      effSum: Format.comma(effSum, 1),
      relicSet,
      affixes,
      affixCols: affixes.length === 9 ? 3 : 4,
      usefulCount,
      affixTotal,
      usefulEff,
      usefulPct,
      showUseful,
      relics,
      rs: {
        grade: ad.markClass || '-',
        gradeColor: gradeStyle(ad.markClass).color,
        gradeBg: gradeStyle(ad.markClass).bg,
        gradeCls: gradeStyle(ad.markClass).cls,
        avg: Format.comma(avgMark, 1),
        max: 60,
        avgPct: Math.max(0, Math.min(100, Math.round(avgMark / 60 * 100))),
        parts,
        metrics: rsMetrics
      },
      dmgTotal,
      enemyLv: enemyLv || '',
      enemyName: enemyName || '小宝',
      notes
    }
  },

  async getProfileDmgCalc ({ profile, enemyLv, mode, params }) {
    let dmgMsg = []
    let dmgData = []
    let dmgCalc = await profile.calcDmg({
      enemyLv,
      mode,
      ...params
    })
    if (dmgCalc && dmgCalc.ret) {
      lodash.forEach(dmgCalc.ret, (ds) => {
        if (ds.type !== 'text') {
          ds.dmg = Format.comma(ds.dmg, 0)
          ds.avg = Format.comma(ds.avg, 0)
        }
        dmgData.push(ds)
      })
      lodash.forEach(dmgCalc.msg, (msg) => {
        msg = msg.replace(':', '：')
        dmgMsg.push(msg.split('：'))
      })

      dmgCalc.dmgMsg = dmgMsg
      dmgCalc.dmgData = dmgData
    }

    if (mode === 'dmg' && dmgCalc.dmgRet) {
      let basic = dmgCalc?.dmgCfg?.basicRet
      lodash.forEach(dmgCalc.dmgRet, (row) => {
        lodash.forEach(row, (ds) => {
          ds.val = (ds.avg > basic.avg ? '+' : '') + Format.comma(ds.avg - basic.avg)
          ds.dmg = Format.comma(ds.dmg, 0)
          ds.avg = Format.comma(ds.avg, 0)
        })
      })
      basic.dmg = Format.comma(basic.dmg)
      basic.avg = Format.comma(basic.avg)
    }

    return dmgCalc
  }
}

export default ProfileDetail