/** vue-tsc 把 uni 的 <switch> 当成 SVG 元素，事件类型是 DOM Event；实际上 uni 的事件带 detail.value */
export function switchValue(e: Event): boolean {
  return Boolean((e as unknown as { detail?: { value?: boolean } }).detail?.value)
}
