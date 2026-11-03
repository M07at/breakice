import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  AVATAR_MAIN,
  avatarImages,
  avatarLayers,
  cycleValue,
  defaultAvatar,
  layerImage,
  normalizeAvatar,
  normalizeNickname,
  DEFAULT_NICKNAME,
  NICKNAME_MAX,
} from '../avatarService'

const staticDir = fileURLToPath(new URL('../../static', import.meta.url))

function staticFile(url: string): string {
  return `${staticDir}${url.replace('/static', '')}`
}

describe('形象图层', () => {
  it('图层顺序是 hat → eyes → mouth → body → color，与首页箭头一致', () => {
    expect(avatarLayers.map((layer) => layer.key)).toEqual(['hat', 'eyes', 'mouth', 'body', 'color'])
  })

  it('每张素材都真实存在于 static 目录', () => {
    expect(existsSync(staticFile(AVATAR_MAIN))).toBe(true)
    for (const layer of avatarLayers) {
      for (let index = 1; index <= layer.count; index++) {
        const url = layerImage(layer.key, index)
        expect(url).toBe(`/static/avatar/${layer.folder}/${layer.folder}${index}.png`)
        expect(existsSync(staticFile(url)), `${url} 缺失`).toBe(true)
      }
    }
  })

  it('叠加顺序是 color → main → body → mouth → eyes → hat', () => {
    const images = avatarImages({ color: 2, body: 3, mouth: 4, eyes: 5, hat: 6 })
    expect(images).toHaveLength(6)
    expect(images[0]).toBe('/static/avatar/color/color2.png')
    expect(images[1]).toBe(AVATAR_MAIN)
    expect(images[2]).toBe('/static/avatar/body/body3.png')
    expect(images[3]).toBe('/static/avatar/mouth/mouth4.png')
    expect(images[4]).toBe('/static/avatar/eyes/eyes5.png')
    expect(images[5]).toBe('/static/avatar/hat/hat6.png')
  })

  it('越界或旧数据结构会被收敛到合法编号', () => {
    expect(normalizeAvatar({ color: 99, hat: 0, eyes: -3, mouth: 2.6 })).toEqual({ color: 17, body: 1, mouth: 3, eyes: 1, hat: 1 })
    expect(normalizeAvatar({ skin: 'warm', hair: 'short' })).toEqual(defaultAvatar)
    expect(normalizeAvatar(null)).toEqual(defaultAvatar)
  })

  it('左右循环切换在两端回绕', () => {
    expect(cycleValue(1, 16, -1)).toBe(16)
    expect(cycleValue(16, 16, 1)).toBe(1)
    expect(cycleValue(8, 16, 1)).toBe(9)
    expect(cycleValue(8, 16, -1)).toBe(7)
    expect(cycleValue(20, 20, 1)).toBe(1)
  })
})

describe('昵称', () => {
  it('去空格、截断到上限，空值回退默认昵称', () => {
    expect(normalizeNickname('  阿冰  ')).toBe('阿冰')
    expect(normalizeNickname('')).toBe(DEFAULT_NICKNAME)
    expect(normalizeNickname('一二三四五六七八九十十一十二十三')).toHaveLength(NICKNAME_MAX)
    expect(normalizeNickname(undefined)).toBe(DEFAULT_NICKNAME)
  })
})
