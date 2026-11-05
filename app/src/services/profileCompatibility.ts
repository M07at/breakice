/** 仅在 RPC 尚未部署时兼容旧后端；网络/鉴权错误不能当成旧版本吞掉。 */
export function isMissingRpc(issue: unknown, name: string): boolean {
  const message = issue instanceof Error ? issue.message : ''
  return message.includes(name) && /could not find|does not exist|schema cache|PGRST202/i.test(message)
}
