/* Runs only in the ignored project made by prepare-bank-smoke.mjs, never in the preview. */
const { bankRepo, LOCAL_USER_ID: user } = require('../../modules/local/session.js')
const { exportBank, importIntoBank } = require('../../modules/bank/service.js')
const receiptKey = 'pobingju:bank-smoke:v22'
const checks = []
const created = []
const assert = (condition, text) => { if (!condition) throw new Error(text) }
const pass = text => { checks.push(text); console.log('[bank-smoke]',text) }
async function rejects(work, code) {
  try { await work(); throw new Error('Expected rejection '+code) }
  catch (error) { assert(error.code === code, error.message) }
}
Page({
  data: { status: '正在检查', checks: [], error: '' },
  onLoad(query) { this.run(query.phase).catch(async error => {
    for (const id of created) await bankRepo().deleteBank(id,user).catch(()=>{})
    if (created.length) wx.removeStorageSync(receiptKey)
    this.setData({ status:'FAIL', checks, error:error.message })
  }) },
  async run(phase) {
    const repo = bankRepo()
    if (phase === 'file-io') {
      const { pickTextFile, saveTextFile, CANCELLED } = require('../../modules/bank/file-io.js')
      const fs=wx.getFileSystemManager()
      const input=wx.env.USER_DATA_PATH+'/bank-smoke-read.csv'
      const output=wx.env.USER_DATA_PATH+'/bank-smoke-write.csv'
      const text='civilian,undercover\r\n苹果,香蕉'
      const choose=wx.chooseMessageFile, share=wx.shareFileMessage
      try {
        fs.writeFileSync(input,text,'utf8')
        wx.chooseMessageFile=options=>options.success({tempFiles:[{path:input,name:'烟测.csv'}]})
        const picked=await pickTextFile()
        assert(picked.text===text && picked.name==='烟测.csv','Native UTF-8 file import failed')
        pass('真实文件系统导入 CSV，中文内容完整')
        let shared=false
        wx.shareFileMessage=options=>{shared=true;options.success({})}
        await saveTextFile('bank-smoke-write.csv',text)
        assert(shared && fs.readFileSync(output,'utf8')===text,'Native file export failed')
        pass('真实文件系统导出；分享接口替身通过，没有实际发送消息')
        wx.chooseMessageFile=options=>options.fail({errMsg:'chooseMessageFile:fail cancel'})
        let cancelled=false
        try { await pickTextFile() } catch(error) { cancelled=error.message===CANCELLED }
        assert(cancelled,'Cancel was not recognized')
        pass('取消选择文件正常返回，不误报读取错误')
      } finally {
        wx.chooseMessageFile=choose;wx.shareFileMessage=share
        for(const path of [input,output])try{fs.unlinkSync(path)}catch{}
      }
      this.setData({status:'PASS: native file IO',checks})
      return
    }
    if (phase === 'resume') {
      const receipt = wx.getStorageSync(receiptKey)
      assert(receipt && receipt.banks.length === 12, 'No completed first-stage receipt')
      for (const entry of receipt.banks) {
        assert((await repo.getBank(entry.id)).name === entry.name, 'Renamed bank lost after restart')
        assert((await repo.listItems(entry.id)).length === entry.count, 'Items lost after restart')
      }
      pass('重启小程序后，四类题库及导入副本完整恢复')
      for (const bank of receipt.banks) await repo.deleteBank(bank.id,user)
      wx.removeStorageSync(receiptKey)
      pass('删除全部烟测题库，保留原有用户数据')
      this.setData({ status:'PASS: restart and cleanup', checks })
      return
    }
    assert(!wx.getStorageSync(receiptKey), 'Prior smoke run needs resume/cleanup first')
    const saved = []
    for (const type of ['undercover','draw','truth','dare']) {
      const system = (await repo.listBanks(user,type)).find(bank=>bank.visibility==='system')
      assert(system && (await repo.listItems(system.id)).length > 0, 'Built-in bank missing')
      await rejects(()=>repo.deleteBank(system.id,user),'READ_ONLY')
      const name = '烟测'+type.slice(0,4)+Date.now().toString(36).slice(-4)
      const bank = await repo.createBank({ name, gameType:type, description:'isolated smoke' },user)
      created.push(bank.id)
      const draft = { content:type==='undercover'?{civilian:'苹果',undercover:'香蕉',drawable:true}:type==='draw'?{word:'苹果',hint:'水果',emoji:'🍎'}:{text:'说出今天的一件开心事'}, tags:['lang:zh','烟测'], difficulty:2 }
      const { added } = await repo.addItems(bank.id,[draft],user)
      assert(added.length===1,'Create item failed')
      assert((await repo.addItems(bank.id,[draft],user)).duplicates===1,'Duplicate not rejected')
      await rejects(()=>repo.addItems(bank.id,[draft,{...draft,content:{}}],user),'INVALID')
      assert((await repo.listItems(bank.id)).length===1,'Invalid batch partially wrote data')
      await rejects(()=>repo.updateBank(bank.id,{name:'越权'},'other'),'NOT_OWNER')
      assert(!(await repo.listBanks('other')).some(b=>b.id===bank.id),'Private bank leaked to another owner')
      await repo.updateItem(added[0].id,{...draft,difficulty:3},user)
      await repo.updateBank(bank.id,{name:name+'改'},user)
      for (const format of ['json','csv']) {
        const file = await exportBank(repo,bank.id,format)
        const copy = await repo.createBank({name:name+format,gameType:type,description:''},user)
        created.push(copy.id)
        assert((await importIntoBank(repo,copy.id,file.text,format,user)).added===1,'Import failed '+format)
        assert((await importIntoBank(repo,copy.id,file.text,format,user)).duplicates===1,'Import duplicate not reported')
        const content=(await repo.listItems(copy.id))[0]
        assert(JSON.stringify(content.content)===JSON.stringify(draft.content),'Content lost in '+format)
        assert(content.difficulty===3 && content.tags.includes('烟测'),'Metadata lost in '+format)
        saved.push({id:copy.id,name:copy.name,count:1})
      }
      await repo.deleteItem(added[0].id,user)
      assert((await repo.listItems(bank.id)).length===0,'Delete item failed')
      await repo.addItems(bank.id,[draft],user)
      saved.push({id:bank.id,name:name+'改',count:1})
      if (type==='undercover') {
        const pool=await repo.listItems(bank.id)
        await repo.updateItem(pool[0].id,{...draft,content:{...draft.content,drawable:false}},user)
        assert((await repo.listItems(bank.id))[0].content.drawable===false,'Drawable flag edit lost')
      }
      pass(type+'：系统只读、创建、增删改、权限、去重、非法批次、CSV/JSON往返')
    }
    const storage=JSON.parse(wx.getStorageSync('pobingju:my-banks:v1'))
    assert(saved.every(bank=>storage.banks.some(b=>b.id===bank.id)),'Actual mini-program storage missed a bank')
    wx.setStorageSync(receiptKey,{banks:saved})
    pass('四类题库均写入真实小程序存储，等待重启验收')
    this.setData({status:'PASS: restart required',checks})
  },
})
