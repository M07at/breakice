import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const bundle = resolve(root, "supabase/functions/uc-command/index.ts")
const sources = [
  "app/src/modules/undercover/engine.ts",
  "app/src/modules/undercover/rules.ts",
  "app/src/modules/undercover/types.ts",
  "app/src/modules/undercover/errors.ts",
  "app/src/modules/undercover/view.ts",
  "app/src/modules/shared/random.ts",
  "supabase/functions/uc-command/handler.ts",
]

const bundleTime = statSync(bundle).mtimeMs
const stale = sources.filter((file) => {
  try {
    return statSync(resolve(root, file)).mtimeMs > bundleTime
  } catch {
    return false
  }
})

if (stale.length > 0) {
  console.log("✗ uc-command 产物落后于源码，请重新打包：")
  for (const file of stale) console.log(`    ${file}`)
  console.log("  命令：node scripts/build-uc-command.mjs")
  process.exit(1)
}
console.log("✓ uc-command 产物是最新的")
