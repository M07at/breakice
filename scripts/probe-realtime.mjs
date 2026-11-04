// 一次性探针：验证 Supabase Realtime 的 broadcast 通道能否用「纯 WebSocket」直接收发。
// 小程序客户端要靠这条协议替代 2 秒轮询，所以先确认服务端支持。
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envFile = resolve(root, 'app/.env.local')

function readEnvFile() {
  if (!existsSync(envFile)) return {}
  const out = {}
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = readEnvFile()
const base = (process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''
if (!base || !key) {
  console.error('缺少配置')
  process.exit(2)
}

const wsUrl = `${base.replace('https://', 'wss://')}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`
const topic = `realtime:probe-${Date.now()}`

function connect(name) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl)
    const log = (label, data) => console.log(`[${name}] ${label}`, typeof data === 'string' ? data.slice(0, 160) : data)
    socket.addEventListener('open', () => {
      log('已连接')
      socket.send(
        JSON.stringify({
          topic,
          event: 'phx_join',
          payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' } } },
          ref: '1',
          join_ref: '1',
        }),
      )
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.event === 'phx_reply') {
        log('phx_reply', message.payload?.status)
        if (message.payload?.status === 'ok') resolve({ socket, ref: '1' })
        else reject(new Error(`join 失败 ${JSON.stringify(message.payload)}`))
      } else if (message.event === 'broadcast') {
        log('收到广播', message.payload)
        resolve({ received: message.payload })
      }
    })
    socket.addEventListener('error', (error) => reject(new Error(String(error?.message ?? error))))
    setTimeout(() => reject(new Error('超时（8s）')), 8000)
  })
}

async function main() {
  console.log('地址：', wsUrl.replace(key, '***'))
  const listener = await connect('listener')
  const sender = await connect('sender')

  const received = new Promise((resolve) => {
    listener.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.event === 'broadcast') resolve(message.payload)
    })
  })

  sender.socket.send(
    JSON.stringify({
      topic,
      event: 'broadcast',
      payload: { type: 'broadcast', event: 'poke', payload: { hello: 'world' } },
      ref: '2',
    }),
  )

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 5000))
  const payload = await Promise.race([received, timeout])
  if (payload) console.log('\n✓ 双向广播成功：', JSON.stringify(payload))
  else console.log('\n✗ 没收到广播（5s 超时）')

  listener.socket.close()
  sender.socket.close()
  process.exit(payload ? 0 : 1)
}

main().catch((e) => {
  console.error('失败：', e.message)
  process.exit(1)
})
