#!/usr/bin/env node
/**
 * 把 C 的谁是卧底引擎打包成**一个自包含的 Edge Function 文件**。
 *
 * 为什么需要这个：Supabase 网页控制台只能部署单文件，import `../_shared/xxx` 会 404；
 * 用 CLI 才支持多文件。为了让「粘一个文件就能上线」这条路成立，这里把
 * app/src/modules/undercover 下的纯逻辑（无 uni 依赖）内联成一份 index.ts。
 *
 * 源仍然是 C 的模块，不要手改生成物：
 *   node scripts/build-uc-command.mjs
 *
 * 生成：supabase/functions/uc-command/index.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// typescript 装在前端的 node_modules 里，从 app/ 解析
const ts = createRequire(resolve(root, 'app/package.json'))('typescript')
const ucDir = resolve(root, 'app/src/modules/undercover')
const seedDir = resolve(root, 'app/src/modules/bank/seed')
const outDir = resolve(root, 'supabase/functions/uc-command')

/** 去掉 import 语句和 export 前缀，让多个模块能拼进同一个作用域 */
function inlineModule(file) {
  const source = readFileSync(file, 'utf8')
  return source
    .replace(/^import\b[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(type|interface|class|function|const|let)\s/gm, '$1 ')
    .replace(/^export\s*\{[\s\S]*?\}\s*$/gm, '')
    .trim()
}

function seedPairs() {
  const files = ['undercover-pairs.json', 'english-pairs.json']
  const pairs = []
  for (const name of files) {
    const doc = JSON.parse(readFileSync(resolve(seedDir, name), 'utf8'))
    for (const item of doc.items ?? []) {
      const content = item.content ?? {}
      if (typeof content.civilian === 'string' && typeof content.undercover === 'string') {
        pairs.push({ civilian: content.civilian, undercover: content.undercover, drawable: Boolean(content.drawable) })
      }
    }
  }
  return pairs
}

const parts = [
  '/**',
  ' * ⚠️ 自动生成，不要直接改这个文件。',
  ' *',
  ' * 来源：',
  ' *   app/src/modules/undercover/{types,errors,rules,engine,view}.ts',
  ' *   app/src/modules/shared/random.ts',
  ' *   app/src/modules/bank/seed/{undercover-pairs,english-pairs}.json',
  ' *   supabase/functions/uc-command/handler.ts',
  ' * 重新生成： node scripts/build-uc-command.mjs',
  ' */',
  'import { createClient } from "https://esm.sh/@supabase/supabase-js@2"',
  '',
  '// ===== 引擎（C 的模块，原样内联）=====',
  inlineModule(resolve(root, 'app/src/modules/shared/random.ts')),
  '',
  inlineModule(resolve(ucDir, 'types.ts')),
  '',
  inlineModule(resolve(ucDir, 'errors.ts')),
  '',
  inlineModule(resolve(ucDir, 'rules.ts')),
  '',
  inlineModule(resolve(ucDir, 'engine.ts')),
  '',
  inlineModule(resolve(ucDir, 'view.ts')),
  '',
  '// ===== 系统词库（来自 C 的 seed JSON）=====',
  `const SEED_PAIRS: { civilian: string; undercover: string; drawable: boolean }[] = ${JSON.stringify(seedPairs())}`,
  '',
  '// ===== 指令处理 =====',
  readFileSync(resolve(outDir, 'handler.ts'), 'utf8'),
]

const bundle = parts.join('\n')
const check = ts.transpileModule(bundle, {
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const syntaxErrors = (check.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error)
if (syntaxErrors.length > 0) {
  for (const d of syntaxErrors) {
    const pos = d.file?.getLineAndCharacterOfPosition(d.start ?? 0)
    console.error(`语法错误 ${pos ? `第 ${pos.line + 1} 行:` : ''} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
  }
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'index.ts'), bundle)
console.log(`已生成 supabase/functions/uc-command/index.ts：${(bundle.length / 1024).toFixed(1)} KB，${bundle.split('\n').length} 行`)
console.log(`内联词对 ${seedPairs().length} 条`)
