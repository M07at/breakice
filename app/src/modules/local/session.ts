/** 题库本地存储适配器；不保存游戏身份或提供玩家切换。 */
import { createSeededRepository } from '../bank'
import { sharedBankRepository } from '../bank/shared'
import type { BankRepository } from '../bank'

let seededRepo: BankRepository | null = null

function localSeeded(): BankRepository {
  if (seededRepo) return seededRepo
  const seeded = createSeededRepository({
    onChange: () => {
      try {
        uni.setStorageSync(BANK_STORAGE_KEY, JSON.stringify(seeded.snapshot()))
      } catch (error) {
        console.warn('自建题库保存失败', error)
      }
    },
  })
  try {
    const saved = uni.getStorageSync(BANK_STORAGE_KEY)
    if (saved) seeded.restore(JSON.parse(String(saved)))
  } catch (error) {
    console.warn('自建题库读取失败，已忽略', error)
  }
  seededRepo = seeded
  return seeded
}

/** 单机模式里的「我」：主持人，也是自建题库的主人 */
export const LOCAL_USER_ID = 'local-host'

/** 自建题库存在手机本地；系统题库每次从代码加载，不占存储 */
const BANK_STORAGE_KEY = 'pobingju:my-banks:v1'

let repo: BankRepository | null = null

/** 共享题库不可用时退回本地题库，保证 H5 至少能用自己的题库 */
function withLocalFallback(shared: BankRepository): BankRepository {
  const local = () => localSeeded()
  const wrap = <K extends keyof BankRepository>(key: K) =>
    ((...args: Parameters<BankRepository[K]>) =>
      (shared[key] as (...a: unknown[]) => Promise<unknown>)(...args).catch(() => (local()[key] as (...a: unknown[]) => Promise<unknown>)(...args))) as BankRepository[K]

  return {
    listBanks: wrap('listBanks'),
    getBank: wrap('getBank'),
    listItems: wrap('listItems'),
    createBank: wrap('createBank'),
    updateBank: wrap('updateBank'),
    deleteBank: wrap('deleteBank'),
    addItems: wrap('addItems'),
    updateItem: wrap('updateItem'),
    deleteItem: wrap('deleteItem'),
  }
}

export function bankRepo(): BankRepository {
  if (repo) return repo
  // #ifdef H5
  // H5 端原本连的是开发用的共享题库服务（/__c1_mock/banks）。
  // 纯静态部署时这个接口不存在，题库会整体不可用，因此加一层本地兜底：
  // 共享服务可用就用共享，不可用就退回到浏览器本地题库。
  repo = withLocalFallback(sharedBankRepository())
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
