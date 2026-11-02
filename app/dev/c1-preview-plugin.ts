import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { C3BankStore } from './c3-bank-store'
import { BankError } from '../src/modules/bank/repository'
import type { Plugin } from 'vite'
import { C1PreviewStore } from './c1-preview-store'
import { isUcError, UcError } from '../src/modules/undercover/errors'
import type { UcClientAction, UcCommandMeta } from '../src/modules/undercover/backend'

export function c1PreviewPlugin(): Plugin {
  const dir = resolve(process.cwd(), '.c3-data'); const file = resolve(dir, 'banks.json')
  let saved: unknown
  if (existsSync(file)) { saved = JSON.parse(readFileSync(file, 'utf8')) }
  const banks = new C3BankStore(saved, data => { mkdirSync(dir, { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify(data)); renameSync(file + '.tmp', file) })
  const store = new C1PreviewStore(undefined, banks)
  return {
    name: 'c1-local-player-preview', apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__c1_mock/')) return next()
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        try {
          const url = new URL(req.url, 'http://localhost')
          const route = url.pathname.slice('/__c1_mock'.length)
          const id = url.searchParams.get('sid') ?? ''
          const ticket = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
          let body: Record<string, unknown> = {}
          if (req.method === 'POST') {
            let raw = ''
            req.setEncoding('utf8')
            for await (const chunk of req) { raw += chunk.toString(); if (raw.length > 1000000) throw new UcError('BAD_REQUEST', '请求过大') }
            try { body = JSON.parse(raw) } catch { throw new UcError('BAD_REQUEST', '无效请求') }
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new UcError('BAD_REQUEST', '无效请求')
          }
          let data: unknown
          if (route === '/banks' && req.method === 'POST') { res.end(JSON.stringify({ value: await banks.invoke(body.operation as string, body.args as unknown[]) })); return }
          if (route === '/sessions' && req.method === 'POST') data = await store.create(body.names as string[], body.blankEnabled as boolean, body.variant as 'classic' | 'draw', body.language as 'zh' | 'en', body.bankIds as string[])
          else if (route === '/session' && req.method === 'GET') data = await store.snapshot(id, ticket)
          else if (route === '/word' && req.method === 'GET') data = await store.word(id, ticket, url.searchParams.get('gameId') ?? '')
          else if (route === '/invites' && req.method === 'GET') data = store.invites(id, ticket)
          else if (route === '/act' && req.method === 'POST') data = await store.act(id, ticket, body.gameId as string, body.action as UcClientAction, body.meta as UcCommandMeta)
          else if (route === '/drawing' && req.method === 'POST') data = await store.submitDrawing(id, ticket, body.gameId as string, body.drawing as import('../src/modules/undercover/player').DrawingSubmission, body.meta as UcCommandMeta)
          else if (route === '/replay' && req.method === 'POST') data = await store.replay(id, ticket, body.requestId as string)
          else throw new UcError('BAD_REQUEST', '未知联调请求')
          res.end(JSON.stringify(data))
        } catch (error) {
          res.statusCode = isUcError(error) || error instanceof BankError ? 400 : 500
          res.end(JSON.stringify({ error: isUcError(error) || error instanceof BankError ? { code: error.code, message: error.message } : { message: '本地联调服务异常' } }))
        }
      })
    },
  }
}
