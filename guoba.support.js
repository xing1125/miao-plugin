/**
 * miao-plugin 锅巴（Guoba）配置面板适配
 *
 * 【适配说明 · 面向 Guoba 2.1.0（V3）】
 * - 契约：export supportGuoba() → { pluginInfo, configInfo:{ schemas, getConfigData, setConfigData } }
 *   Guoba 通过 plugins/miao-plugin/guoba.support.js 动态 import 并调用，无需改任何系统文件。
 * - schema 来源：优先用 miao 规范 API Cfg.getCfgSchema()（与 #喵喵设置 同源，上游新增配置自动出现），
 *   取不到时回退静态导入 config/system/cfg_system.js。
 * - 面板保存经 Cfg.set() 写入 config/cfg.js，与 #喵喵设置 同路径，实时生效、无需重启。
 * - schema 中 miao:true 的项在喵喵系核心（TRSS/miao-yunzai/A-Yunzai）下由 Cfg.get 强制 true，
 *   面板置灰展示为始终开启，且 setConfigData 拒绝修改。
 */
import path from 'node:path'
import lodash from 'lodash'
import { fileURLToPath } from 'node:url'
import { Cfg, Version } from '#miao'
import { cfgSchema as cfgSchemaFallback } from './config/system/cfg_system.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 取配置分组 schema：优先规范 API，失败回退静态表 */
function getSchemaGroups () {
  try {
    const s = Cfg.getCfgSchema && Cfg.getCfgSchema()
    if (s && typeof s === 'object' && Object.keys(s).length) return s
  } catch (e) {
    // 忽略，走回退
  }
  return cfgSchemaFallback
}

/**
 * 按 cfgKey 覆盖默认生成的控件（不修改 config/system 下的系统文件）。
 * 组件名遵循 Guoba 前端（ant-design-vue）：Switch / Input / InputNumber / Select。
 */
const componentOverrides = {
  // ---- 排名相关 ----
  groupRankLimit: {
    component: 'Select',
    componentProps: {
      options: [
        { label: '1 - 无限制', value: 1 },
        { label: '2 - 有CK', value: 2 },
        { label: '3 - 有16个角色或有CK', value: 3 },
        { label: '4 - 有御三家(安柏&凯亚&丽莎)或有CK', value: 4 },
        { label: '5 - 有16个角色+御三家或有CK', value: 5 }
      ]
    }
  },
  rankNumber: {
    componentProps: { min: 5, max: 30, step: 1 }
  },
  // ---- 面板服务 ----
  // 注意：不要用 Select。底层支持分服务器三位数（如 112），Select 无对应项会导致
  // 显示空白、保存时被重置为 0（数据丢失）。用 Input 才能完整表达 0-4 与 112。
  profileServer: {
    component: 'Input',
    componentProps: { placeholder: '0-4，或分服务器三位数字，例如 112' },
    bottomHelpMessage: '面板服务：0:自动，1:喵Api(需Token)，2:Enka-API，3:MiniGG-Api，4:Hutao-Enka代理。三位数按 国服/B服/外服 顺序设置，例如 112 代表国服喵Api、B服喵Api、外服Enka。也可用命令【#喵喵设置面板服务112】'
  },
  srProfileServer: {
    component: 'Input',
    componentProps: { placeholder: '0-4，或分服务器三位数字，例如 114' },
    bottomHelpMessage: '星铁面板服务：0:自动，1:喵Api(需Token)，2:Mihomo，3:Avocado(鳄梨)，4:EnkaHSR。三位数按 国服/B服/外服 顺序设置，例如 114。也可用命令【#喵喵设置星铁面板服务114】'
  },
  teamCalc: {
    bottomHelpMessage: '伤害计算包含组队Buff。目前为测试阶段，数据可能不准确，请慎重开启。数据为固定Buff而非真实面板数据，最终计算数值可能有偏差'
  },
  artisNumber: {
    componentProps: { min: 4, max: 100, step: 1 }
  },
  // ---- 资料查询 ----
  roleCharInfoSource: {
    component: 'Select',
    componentProps: {
      options: [
        { label: '1 - HomDGCat数据库（已阵亡）', value: 1 },
        { label: '2 - BWiki数据库（不建议使用）', value: 2 },
        { label: '3 - hakush.in数据库（已阵亡）', value: 3 },
        { label: '4 - nanoka.cc数据库（默认）', value: 4 }
      ]
    }
  },
  // ---- 系统设置 ----
  renderScale: {
    componentProps: { min: 50, max: 200, step: 5 }
  },
  originalPic: {
    component: 'Select',
    componentProps: {
      options: [
        { label: '0 - 不允许', value: 0 },
        { label: '1 - 仅允许角色图', value: 1 },
        { label: '2 - 仅允许面板图', value: 2 },
        { label: '3 - 开启', value: 3 },
        { label: '4 - 仅不允许获取面板图列表', value: 4 }
      ]
    }
  },
  commaGroup: {
    componentProps: { min: 1, max: 6, step: 1 }
  }
}

/** 以 cfgKey 为键的 schema 映射（cfgKey 为扁平配置键） */
function buildCfgSchemaMap (groups) {
  const map = {}
  lodash.forEach(groups, (group) => {
    lodash.forEach(group.cfg, (item, cfgKey) => {
      map[cfgKey] = item
    })
  })
  return map
}

/** 由 schema 自动生成 Guoba 表单 schema */
function buildSchemas (groups) {
  const schemas = []
  let cfg = {}
  try {
    cfg = Cfg.getCfg() || {}
  } catch (e) {
    cfg = {}
  }
  lodash.forEach(groups, (group) => {
    schemas.push({
      component: 'SOFT_GROUP_BEGIN',
      label: group.title
    })
    lodash.forEach(group.cfg, (item, cfgKey) => {
      const field = {
        field: cfgKey,
        label: item.title || item.key || cfgKey
      }
      if (item.desc) {
        field.bottomHelpMessage = item.desc
      }
      if (item.type === 'num') {
        field.component = 'InputNumber'
        field.componentProps = {}
      } else if (item.type === 'str') {
        field.component = 'Input'
        field.componentProps = {}
      } else {
        field.component = 'Switch'
        field.componentProps = {}
      }
      const override = componentOverrides[cfgKey]
      if (override) {
        lodash.merge(field, override)
      }
      // 已有自定义值不在 Select 选项内时补一项，避免显示空白 / 保存被重置
      if (field.component === 'Select' && Array.isArray(field.componentProps?.options)) {
        const cur = cfg[cfgKey]
        const has = field.componentProps.options.some((o) => String(o.value) === String(cur))
        if (cur !== undefined && cur !== null && cur !== '' && !has) {
          field.componentProps.options = field.componentProps.options.concat([{ label: `当前值 ${cur}`, value: cur }])
        }
      }
      if (item.miao && Version.isMiao) {
        field.componentProps.disabled = true
        field.bottomHelpMessage = (item.desc ? `${item.desc}\n` : '') + '※ 喵喵系Yunzai核心下本项始终开启'
      }
      schemas.push(field)
    })
  })
  return schemas
}

/** 把前端值按 schema 规整为要落盘的值 */
function normalizeValue (item, val) {
  if (item.input) {
    return item.input(val)
  }
  if (item.type === 'num') {
    const n = Number(val)
    return Number.isFinite(n) ? n : item.def
  }
  if (item.type === 'str') {
    return (lodash.isNil(val) || val === '') ? String(item.def) : String(val)
  }
  return !!val
}

export function supportGuoba () {
  const groups = getSchemaGroups()
  const cfgSchemaMap = buildCfgSchemaMap(groups)

  return {
    pluginInfo: {
      name: 'miao-plugin',
      title: '喵喵插件',
      author: '@yoimiya-kokomi',
      authorLink: 'https://github.com/yoimiya-kokomi',
      link: 'https://github.com/yoimiya-kokomi/miao-plugin',
      isV3: true,
      isV2: false,
      showInMenu: 'auto',
      description: '喵喵插件：提供角色面板、角色查询、练度统计、抽卡分析、角色百科、帮助配置等功能',
      icon: 'mdi:cat',
      iconColor: '#e9b16d',
      iconPath: path.join(__dirname, 'resources/common/icon.png')
    },
    configInfo: {
      schemas: buildSchemas(groups),
      // 获取配置数据（用于前端填充显示数据）
      getConfigData () {
        let cfg = {}
        try {
          cfg = Cfg.getCfg() || {}
        } catch (e) {
          cfg = {}
        }
        const ret = {}
        lodash.forEach(cfgSchemaMap, (item, cfgKey) => {
          let val = cfg[cfgKey]
          if (lodash.isUndefined(val)) {
            val = item.def
          }
          if (item.miao && Version.isMiao) {
            val = true
          }
          ret[cfgKey] = val
        })
        return ret
      },
      // 设置配置（前端点确定后调用）：校验后经 Cfg.set 写入，实时生效
      setConfigData (data, { Result }) {
        let count = 0
        let skipped = 0
        lodash.forEach(data || {}, (val, cfgKey) => {
          const item = cfgSchemaMap[cfgKey]
          if (!item) {
            return
          }
          // 喵喵系核心下始终开启的项不接受修改
          if (item.miao && Version.isMiao) {
            skipped++
            return
          }
          Cfg.set(cfgKey, normalizeValue(item, val))
          count++
        })
        return Result.ok({}, `保存成功，配置已实时生效（更新${count}项${skipped ? `，${skipped}项在喵喵系核心下始终开启` : ''}）`)
      }
    }
  }
}
