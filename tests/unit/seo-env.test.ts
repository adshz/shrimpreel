import { describe, expect, it } from 'vitest'
import { ARTICLES, isoTimestamp, site } from '../../src/config/site'
import { PUBLIC_PATHS, lastModified } from '../../src/server/seo'
import { isIndexable, shouldNoindex } from '../../src/server/util'

describe('staging 不收录、正式站放行是同一个开关', () => {
  it('只有 production 且 INDEXABLE=true 才可被收录，其余都要 noindex（本地开发除外）', () => {
    expect(isIndexable({ APP_ENV: 'production', INDEXABLE: 'true' })).toBe(true)
    expect(shouldNoindex({ APP_ENV: 'production', INDEXABLE: 'true' })).toBe(false)
    expect(isIndexable({ APP_ENV: 'staging', INDEXABLE: 'false' })).toBe(false)
    expect(shouldNoindex({ APP_ENV: 'staging', INDEXABLE: 'false' })).toBe(true)
    expect(isIndexable({ APP_ENV: 'staging', INDEXABLE: 'true' })).toBe(false)
    expect(shouldNoindex({ APP_ENV: 'staging', INDEXABLE: 'true' })).toBe(true)
    expect(shouldNoindex({ APP_ENV: 'production' })).toBe(true)
    expect(shouldNoindex({ APP_ENV: 'development', INDEXABLE: 'false' })).toBe(false)
    expect(shouldNoindex({})).toBe(false)
  })

  it('任何组合下，可收录和要 noindex 不会同时为真', () => {
    for (const APP_ENV of ['production', 'staging', 'development', undefined]) {
      for (const INDEXABLE of ['true', 'false', undefined]) {
        expect(isIndexable({ APP_ENV, INDEXABLE }) && shouldNoindex({ APP_ENV, INDEXABLE })).toBe(false)
      }
    }
  })
})

describe('sitemap lastmod', () => {
  const today = new Date().toISOString().slice(0, 10)

  it('lastmod 输出为完整 ISO 时间戳，和文章的 dateModified 同值', () => {
    expect(isoTimestamp('2026-10-28')).toBe('2026-10-28T00:00:00+00:00')
    for (const a of ARTICLES) expect(isoTimestamp(lastModified(`/${a.slug}`))).toBe(isoTimestamp(a.updatedAt))
  })

  it('每个公开页面都有源日期，是 YYYY-MM-DD，不晚于今天', () => {
    for (const path of PUBLIC_PATHS) {
      const d = lastModified(path)
      expect(d, path).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(d <= today, `${path} 的 lastmod ${d} 晚于今天`).toBe(true)
    }
  })

  it('文章的 lastmod 就是 Article 的 dateModified 和页面显示的更新日期（同一个 updatedAt）', () => {
    for (const a of ARTICLES) {
      expect(a.updatedAt >= a.publishedAt).toBe(true)
      expect(lastModified(`/${a.slug}`)).toBe(a.updatedAt)
    }
  })

  it('/guides 跟最新一篇文章走', () => {
    expect(lastModified('/guides')).toBe(ARTICLES.map((a) => a.updatedAt).sort().at(-1))
  })

  it('pageUpdatedAt 里没有多余的路径', () => {
    for (const path of Object.keys(site.seo.pageUpdatedAt)) expect(PUBLIC_PATHS).toContain(path)
  })
})
