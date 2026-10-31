# C4 工程、CI与发布验收

## 初次配置
使用Node.js 22（.nvmrc/.node-version），在app目录执行npm ci。无需真实密钥即可运行开发联调。按需复制.env.example为.env.local；只有公开配置可用VITE_前缀。真实后端key由A的服务保存，配置公开URL不等于已经安装真实平台适配器。

npm run doctor检查Node、必要文件和公开环境变量形状；只打印变量名，不输出值。npm run dev:players启动本地同步预览。手机使用Network地址。共享题库数据app/.c3-data/banks.json独立保存且不提交，更新代码前可备份该文件。

## 一条验证命令
在app执行npm run verify；也可从仓库根执行npm --prefix app run verify。
依次执行doctor、TypeScript、Vitest及JUnit报告、质量门禁测试、小程序构建、H5构建、包体限制、源码/构建密钥扫描、构建文件SHA-256清单。任何一步失败立即停止，app/reports/verify.json记录失败步骤和退出码，后续步骤不会伪装为通过。reports和dist不提交。

产物：app/reports/tests.xml、verify.json、release-manifest.json；app/dist/build/mp-weixin和h5。校验清单用于比对交付文件，不代表已发布。

## Gitee激活（尚未执行）
本仓库远程为Gitee。scripts/ci.sh是可运行构建入口，.gitee/ci-job.json是具体作业配置清单，不是会被Gitee自动加载的YAML。仓库管理员在现有Gitee流水线中选择Node.js 22运行环境，绑定本仓库代码源，设置PR到master与master推送触发，根目录命令为sh scripts/ci.sh，并保留上述报告与构建产物。失败退出码必须使作业失败，禁止失败后继续并显示成功。

管理员还需将该检查配置为合并前要求；本地文件无法验证远端保护分支或Webhook。没有登录Gitee管理会话，本轮未开通流水线、创建Webhook、推送代码或改变远端设置。完成激活后用故意失败的测试PR验证红灯，再修复确认绿灯，保留链接。不要将配置文件存在当作自动PR检查已生效。

来源：Gitee关于代码源绑定和PR/push触发的官方说明 https://help.gitee.com/enterprise/pipeline/source/trigger/ ，Gitee Go概览 https://gitee.com/features/gitee-go 。具体可选运行环境以账户控制台为准，不伪造未经验证的流水线插件版本或YAML。

## 发布与回退
发布前按照release-checklist.md逐项记录；CI只构建，不上传微信、不部署网站、不发布、不持有上传密钥。发布账号管理员确认后另行执行上传/发布。
回退代码：选择已评审版本重新构建，使用对应清单核对；不混用上一版dist和下一版源码。共享题库是独立数据文件，代码回退不删除它。将来A增加真实数据库迁移时，必须由A提供迁移/回退方案后再接入CI；当前没有数据库迁移可验证。

## 当前证据边界
本地/浏览器模拟检查不等于微信真机、真实账号鉴权、RLS、实际画布或AI性能验收。C1/C2/C3相关接口文档位于本目录，未完成项必须进入验收清单，不能由CI构建成功代替。
