import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const target = resolve(root, 'app/reports/bank-smoke-project')
cpSync(resolve(root, 'app/dist/build/mp-weixin'), target, { recursive: true })
mkdirSync(join(target, 'pages/qa'), { recursive: true })
const app = JSON.parse(readFileSync(join(target, 'app.json')))
app.pages.push('pages/qa/bank-smoke')
writeFileSync(join(target, 'app.json'), JSON.stringify(app))
cpSync(resolve(root, 'scripts/fixtures/bank-smoke-page.js'), join(target, 'pages/qa/bank-smoke.js'))
writeFileSync(join(target, 'pages/qa/bank-smoke.json'), JSON.stringify({ navigationBarTitleText: '词库烟测（隔离）' }))
writeFileSync(join(target, 'pages/qa/bank-smoke.wxml'), '<view style="padding:30rpx"><text>{{status}}</text><view wx:for="{{checks}}" wx:key="*this" style="margin-top:16rpx">✓ {{item}}</view><text>{{error}}</text></view>')
console.log(target)
