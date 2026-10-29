import { existsSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { seoRoutes } from '#/server/seo'

type Config = Record<string, unknown> & { name: string; vars: Record<string, string> }

function readJsonc(file: string): Config {
  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'))
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'))
  return config
}

// 资源标识（库名、桶名、id、队列名、限流命名空间）两份配置必须不同；其余结构必须一致
const RESOURCE_KEYS = new Set(['database_name', 'database_id', 'bucket_name', 'id', 'queue', 'dead_letter_queue', 'namespace_id'])

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'vars' ? Object.keys(v).sort() : RESOURCE_KEYS.has(k) ? '<resource>' : shape(v)]))
  }
  return value
}

function resources(value: unknown, out: Record<string, string[]> = {}): Record<string, string[]> {
  if (Array.isArray(value)) value.forEach((v) => resources(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (RESOURCE_KEYS.has(k) && typeof v === 'string') (out[k] ??= []).push(v)
      else if (k !== 'vars') resources(v, out)
    }
  }
  return out
}

// 新站点由 new-site 删除 wrangler.staging.jsonc，此时跳过。跳过的 describe 回调仍会执行，所以不存在时不能读文件
const hasStaging = existsSync('wrangler.staging.jsonc')
describe.skipIf(!hasStaging)('wrangler.staging.jsonc', () => {
  const main = readJsonc('wrangler.jsonc')
  const staging = hasStaging ? readJsonc('wrangler.staging.jsonc') : main

  it('绑定、vars 键和运行参数与 wrangler.jsonc 一致', () => {
    const { name: _m, ...mainRest } = main
    const { name: _s, ...stagingRest } = staging
    expect(shape(stagingRest)).toEqual(shape(mainRest))
  })

  // 漏改一个名字，staging 就会读写正式站的库、桶或队列
  it('资源名都带 -staging，且不与 wrangler.jsonc 共用', () => {
    expect(staging.name).toBe(`${main.name}-staging`)
    const own = resources(staging)
    const theirs = resources(main)
    for (const key of ['database_name', 'bucket_name', 'queue', 'dead_letter_queue']) {
      for (const value of own[key] ?? []) expect(value, key).toMatch(new RegExp(`^${staging.name}(-|$)`))
    }
    for (const key of ['database_id', 'id', 'namespace_id']) {
      const real = (own[key] ?? []).filter((v) => !/^0+(-0+)*$/.test(v))
      expect(real.filter((v) => theirs[key]?.includes(v)), key).toEqual([])
    }
  })

  it('INDEXABLE：预发 false，两份配置都写了；正式站上线前默认 false', () => {
    expect(staging.vars.INDEXABLE).toBe('false')
    expect(main.vars.INDEXABLE).toBeDefined()
  })

  it('按生产行为运行，不用 mock', () => {
    expect(staging.vars.APP_ENV).toBe('staging')
    for (const key of ['PAYMENT_PROVIDER', 'VIDEO_PROVIDER', 'MODERATION_PROVIDER']) expect(staging.vars[key], key).not.toBe('mock')
    expect(staging.vars.SITE_URL).toMatch(new RegExp(`^https://${staging.name}\\.[a-z0-9-]+\\.workers\\.dev$`, 'i'))
  })
})

describe('robots.txt', () => {
  const robots = async (APP_ENV: string, INDEXABLE?: string) => (await seoRoutes.request('/robots.txt', {}, { APP_ENV, INDEXABLE } as unknown as Env)).text()

  it('只有 production 允许抓取，staging 与正式站内容相同，必须整体禁止', async () => {
    expect(await robots('production', 'true')).toMatch(/^Allow: \/$/m)
    expect(await robots('production', 'true')).toMatch(/^Sitemap: https:\/\/.+\/sitemap\.xml$/m)
    expect(await robots('staging', 'false')).toMatch(/^Disallow: \/$/m)
    expect(await robots('development', 'false')).toMatch(/^Disallow: \/$/m)
    // 两个条件都要满足：staging 误配 INDEXABLE=true 不放行；正式站漏配 INDEXABLE 也不放行（doctor 会报错）
    expect(await robots('staging', 'true')).toMatch(/^Disallow: \/$/m)
    expect(await robots('production')).toMatch(/^Disallow: \/$/m)
  })
})
