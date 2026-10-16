/**
 * 题库文件的读写，按平台条件编译：
 * - 微信小程序：从聊天记录选文件（wx.chooseMessageFile），导出时写到用户目录再分享到聊天
 * - H5：浏览器选文件 / 下载
 * 这里只做文件 IO，解析和校验在 importer.ts。
 */

// 只在 MP-WEIXIN 分支里用到
declare const wx: { env: { USER_DATA_PATH: string } }

export const CANCELLED = 'CANCELLED'

export interface PickedFile {
  name: string
  text: string
}

// 平台分支在编译时只保留一个；先置 null，都不匹配时才返回失败（提前创建 rejected Promise 会触发未处理的 rejection）
export function pickTextFile(): Promise<PickedFile> {
  let result: Promise<PickedFile> | null = null
  // #ifdef MP-WEIXIN
  result = new Promise((resolve, reject) => {
    uni.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'json', 'txt'],
      success: (res) => {
        const file = res.tempFiles[0]
        uni.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (r) => resolve({ name: file.name, text: String(r.data) }),
          fail: () => reject(new Error('读取文件失败')),
        })
      },
      fail: (e) => reject(new Error(e.errMsg.includes('cancel') ? CANCELLED : '选择文件失败')),
    })
  })
  // #endif
  // #ifdef H5
  result = new Promise((resolve, reject) => {
    uni.chooseFile({
      count: 1,
      extension: ['.csv', '.json', '.txt'],
      success: (res) => {
        const files = res.tempFiles
        const file = (Array.isArray(files) ? files[0] : files) as File
        const reader = new FileReader()
        reader.onload = () => resolve({ name: file.name, text: String(reader.result) })
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsText(file, 'utf-8')
      },
      fail: () => reject(new Error(CANCELLED)),
    })
  })
  // #endif
  return result ?? Promise.reject(new Error('当前平台不支持选择文件，请用粘贴导入'))
}

export function saveTextFile(fileName: string, text: string): Promise<void> {
  let result: Promise<void> | null = null
  // #ifdef MP-WEIXIN
  result = new Promise((resolve, reject) => {
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`
    uni.getFileSystemManager().writeFile({
      filePath,
      data: text,
      encoding: 'utf8',
      success: () => {
        // 分享到聊天（比如文件传输助手），用户在电脑上就能拿到文件
        uni.shareFileMessage({
          filePath,
          fileName,
          success: () => resolve(),
          fail: (e) => (e.errMsg.includes('cancel') ? resolve() : reject(new Error('分享文件失败，可以改用复制'))),
        })
      },
      fail: () => reject(new Error('保存文件失败')),
    })
  })
  // #endif
  // #ifdef H5
  const type = fileName.endsWith('.json') ? 'application/json' : 'text/csv;charset=utf-8'
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  result = Promise.resolve()
  // #endif
  return result ?? Promise.reject(new Error('当前平台不支持导出文件，请复制内容'))
}

export function copyText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    uni.setClipboardData({ data: text, success: () => resolve(), fail: () => reject(new Error('复制失败')) })
  })
}
