import { afterEach, describe, expect, it, vi } from 'vitest'
import { MBTI_TYPES, mbtiGroup, normalizeMbti } from '../../modules/shared/mbti'
import { defaultAvatar, getSavedProfile, saveProfile } from '../avatarService'
import { isMissingRpc } from '../profileCompatibility'

afterEach(() => vi.unstubAllGlobals())

describe('MBTI profile data', () => {
  it('maps all sixteen types into four groups of four', () => {
    expect(new Set(MBTI_TYPES).size).toBe(16)
    const groups = MBTI_TYPES.map(mbtiGroup)
    for (const group of ['analyst', 'diplomat', 'sentinel', 'explorer']) {
      expect(groups.filter(value => value === group)).toHaveLength(4)
    }
    expect(mbtiGroup('INTJ')).toBe('analyst')
    expect(mbtiGroup('ENFP')).toBe('diplomat')
    expect(mbtiGroup('ISFJ')).toBe('sentinel')
    expect(mbtiGroup('ESTP')).toBe('explorer')
  })

  it('normalizes valid choices and rejects unsupported data', () => {
    expect(normalizeMbti(' enfp ')).toBe('ENFP')
    for (const value of ['', null, undefined, 'ABCD', 'INTJ-A', 123]) {
      expect(normalizeMbti(value)).toBeNull()
    }
  })

  it('loads an old profile and preserves name/avatar while saving or clearing MBTI', () => {
    let saved: unknown = { nickname: '阿冰', avatar: defaultAvatar }
    vi.stubGlobal('uni', {
      getStorageSync: () => saved,
      setStorageSync: (_key: string, value: unknown) => { saved = value },
    })
    expect(getSavedProfile()).toMatchObject({ nickname: '阿冰', mbti: null })
    saveProfile({ ...getSavedProfile(), mbti: 'ENFP' })
    expect(getSavedProfile()).toMatchObject({ nickname: '阿冰', avatar: defaultAvatar, mbti: 'ENFP' })
    saveProfile({ ...getSavedProfile(), mbti: null })
    expect(getSavedProfile().mbti).toBeNull()
  })

  it('only falls back for a missing RPC, not a network or permission failure', () => {
    expect(isMissingRpc(new Error('Could not find the function public.set_my_profile_v2 in the schema cache'), 'set_my_profile_v2')).toBe(true)
    expect(isMissingRpc(new Error('set_my_profile_v2 permission denied'), 'set_my_profile_v2')).toBe(false)
    expect(isMissingRpc(new Error('network unavailable'), 'set_my_profile_v2')).toBe(false)
  })
})
