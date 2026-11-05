/** 同时内联到 Edge Function，保持存储路径和当前作画者校验一致。 */
export function validDrawingRef(roomId: string, roundKey: string, painterId: string, imageRef: string): boolean {
  const prefix = `${roomId}/draw/${roundKey}/${painterId}-`
  return /^r[1-9]\d*$/.test(roundKey)
    && imageRef.startsWith(prefix)
    && /^\d+\.png$/.test(imageRef.slice(prefix.length))
}
