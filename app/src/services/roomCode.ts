/** 只提取房间号；不执行二维码中的 URL，也不截断无效内容。 */
export function parseRoomCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const decoded = decodeURIComponent(value.trim())
    const parameter = decoded.match(/[?&](?:code|scene)=([^&#]+)/)?.[1]
    const code = decodeURIComponent(parameter ?? decoded).trim().toUpperCase()
    return /^[A-Z0-9]{6}$/.test(code) ? code : null
  } catch {
    return null
  }
}
