import type { BankRepository, BankErrorCode } from './repository'
import { BankError } from './repository'
export function sharedBankRepository(): BankRepository {
  return new Proxy({} as BankRepository, { get: (_, operation: string) => (...args: unknown[]) => new Promise((resolve, reject) => {
    uni.request({ url: '/__c1_mock/banks', method: 'POST', data: { operation, args }, timeout: 8000,
      success: response => { const data = response.data as { error?: {code: BankErrorCode;message: string}; value?: unknown }; if (response.statusCode === 200 && !data.error) resolve(data.value); else reject(new BankError(data.error?.code ?? 'INVALID', data.error?.message ?? '共享题库暂不可用')) },
      fail: () => reject(new Error('无法连接共享题库，请保持开发服务运行')),
    })
  }) })
}
