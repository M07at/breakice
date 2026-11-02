/** 题库本地存储适配器；不保存游戏身份或提供玩家切换。 */
import { createSeededRepository } from '../bank'
import { sharedBankRepository } from '../bank/shared'
import type { BankRepository } from '../bank'

/** 单机模式里的「我」：主持人，也是自建题库的主人 */
export const LOCAL_USER_ID = 'local-host'

/** 自建题库存在手机本地；系统题库每次从代码加载，不占存储 */
const BANK_STORAGE_KEY = 'pobingju:my-banks:v1'

let repo: BankRepository | null = null

export function bankRepo(): BankRepository {
  if (repo) return repo
  // #ifdef H5
  repo = sharedBankRepository()
  return repo
  // #endif
  const seeded = createSeededRepository({
    onChange: () => {
      try {
        uni.setStorageSync(BANK_STORAGE_KEY, JSON.stringify(seeded.snapshot()))
      } catch (e) {
        console.warn('自建题库保存失败', e)
      }
    },
  })
  try {
    const saved = uni.getStorageSync(BANK_STORAGE_KEY)
    if (saved) seeded.restore(JSON.parse(String(saved)))
  } catch (e) {
    console.warn('自建题库读取失败，已忽略', e)
  }
  repo = seeded
  return repo!
}
