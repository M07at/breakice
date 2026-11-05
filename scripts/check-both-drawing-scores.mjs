import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expectedClassFor, DRAWZY_CLASSES } from '../app/src/modules/draw/classMap.ts'
const root=resolve(import.meta.dirname,'..')
const env=Object.fromEntries(readFileSync(resolve(root,'app/.env.local'),'utf8').split(/\r?\n/).map(s=>s.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^["']|["']$/g,'')]))
let token,gameId
const rooms=[]
const report={at:new Date().toISOString(),checks:[]}
async function call(path,body,method='POST',binary=false){
  const r=await fetch(env.VITE_SUPABASE_URL+path,{method,headers:{apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${token||env.VITE_SUPABASE_ANON_KEY}`,'Content-Type':binary?'image/png':'application/json'},body:body===undefined?undefined:binary?body:JSON.stringify(body),signal:AbortSignal.timeout(65000)})
  const data=await r.json().catch(()=>null)
  assert(r.ok,`${path}: ${r.status} ${JSON.stringify(data)}`);return data
}
const rpc=(name,body)=>call('/rest/v1/rpc/'+name,body)
const uc=body=>call('/functions/v1/uc-command',body)
const pass=text=>{report.checks.push(text);console.log('✓ '+text)}
try{
  const host=await call('/auth/v1/signup',{});token=host.access_token
  const [room]=await rpc('create_room',{p_title:'双绘画评分烟测',p_game_type:'lobby',p_max_players:8,p_settings:{}});rooms.push(room.room_id)
  let snapshot,word,label
  for(let i=0;i<40;i++){
    if(gameId) await uc({op:'act',game_id:gameId,action:{type:'endGame'},meta:{requestId:crypto.randomUUID()}})
    await rpc('set_ready',{p_room_id:room.room_id,p_ready:true})
    snapshot=await uc({op:'start',room_id:room.room_id,variant:'draw',bots:3,request_id:crypto.randomUUID(),config:{drawSeconds:180}})
    gameId=snapshot.gameId
    word=(await uc({op:'word',game_id:gameId})).word
    label=expectedClassFor(word)||DRAWZY_CLASSES.find(value=>value===String(word).trim().toLowerCase())
    if(label&&DRAWZY_CLASSES.includes(label))break
  }
  assert(label,'No supported private test word was drawn')
  const png=resolve(root,'app/reports/both-mode-sketch.png')
  const python=process.env.DRAWZY_PYTHON||resolve(root,'../.local-services/drawzy-ai/.venv/Scripts/python.exe')
  const rendered=spawnSync(python,[resolve(root,'scripts/render_canvas_fixture.py'),label,png],{encoding:'utf8',windowsHide:true})
  assert.equal(rendered.status,0,rendered.stderr)
  const bytes=readFileSync(png)
  const ref=`${room.room_id}/${gameId}/score-smoke/${host.user.id}.png`
  await call('/storage/v1/object/artworks/'+ref,bytes,'POST',true)
  const id=await rpc('submit_artwork',{p_game_id:gameId,p_turn_key:`${snapshot.view.turnKey}#${host.user.id}`,p_storage_path:ref})
  const hybrid=await call('/functions/v1/ai-score',{artwork_id:id})
  assert.equal(hybrid.status,'success',JSON.stringify(hybrid))
  assert.equal(hybrid.scoringVersion,'confidence-v3')
  assert.equal(hybrid.total,Math.round(hybrid.confidence*100))
  const cached=await call('/functions/v1/ai-score',{artwork_id:id})
  assert.equal(cached.total,hybrid.total)
  pass(`Hybrid AI score ${hybrid.total}/100, live canvas-ink-v3; cached receipt unchanged`)
  const [ordinary]=await rpc('create_room',{p_title:'普通评分对照烟测',p_game_type:'lobby',p_max_players:4,p_settings:{}});rooms.push(ordinary.room_id)
  await rpc('publish_draw_view',{p_room_id:ordinary.room_id,p_view:{gameId:`compare-${Date.now()}`,phase:'drawing',roundKey:'r1',painterId:host.user.id,players:[{id:host.user.id}],startedAt:Date.now(),endsAt:Date.now()+60000,word:null,palette:[]}})
  await rpc('publish_draw_word',{p_room_id:ordinary.room_id,p_round_key:'r1',p_user_id:host.user.id,p_word:word})
  const ordinaryRef=`${ordinary.room_id}/draw/r1/${host.user.id}-${Date.now()}.png`
  await call('/storage/v1/object/artworks/'+ordinaryRef,bytes,'POST',true)
  const regular=await call('/functions/v1/draw-score',{room_id:ordinary.room_id,round_key:'r1',image_ref:ordinaryRef})
  assert.equal(regular.status,'success',JSON.stringify(regular));assert.equal(regular.scoringVersion,'confidence-v3')
  assert.equal(regular.total,hybrid.total)
  pass(`Ordinary AI score ${regular.total}/100; same picture and prompt produce the same score in both games`)
  report.result={targetClass:label,hybridScore:hybrid.total,ordinaryScore:regular.total,preprocessingVersion:regular.preprocessingVersion}
}catch(error){report.error=error.message;console.error(error.message);process.exitCode=1}
finally{
  for(const id of rooms){try{await rpc('close_room',{p_room_id:id})}catch(error){console.error('Cleanup failed: '+error.message);process.exitCode=1}}
  report.cleaned=rooms.length
  writeFileSync(resolve(root,`app/reports/both-drawing-scores-${Date.now()}.json`),JSON.stringify(report,null,2))
}
