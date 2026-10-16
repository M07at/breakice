/**
 * 前端只读公开配置。密钥不允许出现在前端，CI 的 check-secrets 会扫描打包产物。
 * 变量说明见 app/.env.example。
 */
export interface AppEnv {
  appEnv: 'dev' | 'prod'
  supabaseUrl: string
  supabaseAnonKey: string
  wxCloudEnv: string
}

export const env: AppEnv = {
  appEnv: import.meta.env.VITE_APP_ENV === 'prod' ? 'prod' : 'dev',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  wxCloudEnv: import.meta.env.VITE_WX_CLOUD_ENV ?? '',
}

/** 后端还没配好时，C 的页面用单机实现（LocalUcBackend / MemoryBankRepository） */
export const backendConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)
