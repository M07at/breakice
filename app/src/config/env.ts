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

/** 仅表示公开配置齐全；不表示真实后端适配器已安装。开发联调使用独立的预览服务。 */
export const backendConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)
