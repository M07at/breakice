"""按学院模板生成《软件工程》项目报告：D 负责部分写全，A/B/C 模块留空并标注。"""
import sys
from copy import deepcopy

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Pt, Cm

SRC = r"C:\Users\10279\Downloads\《软件工程》项目报告撰写内容及规范化参考样本.docx"
DST = sys.argv[1]
TITLE = "破冰局——基于微信小程序的多人在线聚会游戏平台"

doc = Document(SRC)
body = doc.element.body

# ---- 找到正文起点（"1 问题定义"），删掉模板里的示例正文，保留封面/任务书/目录 ----
start_index = None
for i, p in enumerate(doc.paragraphs):
    if p.text.strip().startswith("1 问题定义"):
        start_index = i
        break
if start_index is None:
    raise SystemExit("找不到正文起点")

for p in doc.paragraphs[start_index:]:
    p._element.getparent().remove(p._element)
# 删掉正文之后可能残留的分节符段落
for para in list(body.iterchildren()):
    if para.tag.endswith("sectPr"):
        continue

# 模板正文里的示例表格也要一并清掉，否则会混进我们的内容里
for t in list(doc.tables):
    t._element.getparent().remove(t._element)


def set_font(run, name="宋体", size=12, bold=False, ascii_name="Times New Roman"):
    run.font.name = ascii_name
    run.font.size = Pt(size)
    run.font.bold = bold
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)


def chapter(text):
    p = doc.add_paragraph(style="Heading 1")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(12)
    set_font(p.add_run(text), name="黑体", size=18, bold=True)
    return p


def section(text):
    p = doc.add_paragraph(style="Heading 2")
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(4)
    set_font(p.add_run(text), name="黑体", size=14, bold=True)
    return p


def sub(text):
    p = doc.add_paragraph(style="Heading 3")
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(2)
    set_font(p.add_run(text), name="黑体", size=12, bold=True)
    return p


def para(text, indent=True):
    p = doc.add_paragraph()
    fmt = p.paragraph_format
    fmt.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    fmt.space_after = Pt(0)
    if indent:
        fmt.first_line_indent = Cm(0.85)
    set_font(p.add_run(text), name="宋体", size=12)
    return p


def bullets(items):
    for item in items:
        para("· " + item)


def placeholder(member, what):
    """其他成员负责的部分：留空并标注"""
    p = doc.add_paragraph()
    fmt = p.paragraph_format
    fmt.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    fmt.space_before = Pt(4)
    run = p.add_run(f"【待 {member} 补充：{what}】")
    set_font(run, name="宋体", size=12, bold=True)
    return p


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        set_font(p.add_run(h), name="黑体", size=9, bold=True)
    for row in rows:
        cells = t.add_row().cells
        for i, value in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            set_font(p.add_run(str(value)), name="宋体", size=9)
    if widths:
        for index, width in enumerate(widths):
            for row in t.rows:
                row.cells[index].width = Cm(width)
    doc.add_paragraph()
    return t


IMG_DIR = r"D:\1\break-ice-hall\docs\报告\images"


def figures(items, width_cm=4.8):
    """同一行放若干张图（行内并排），图题放在下一行居中"""
    import os
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for index, (name, title) in enumerate(items):
        if index > 0:
            p.add_run("    ")
        p.add_run().add_picture(os.path.join(IMG_DIR, name), width=Cm(width_cm))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(cap.add_run("　　".join(title for _, title in items)), name="黑体", size=9)
    cap.paragraph_format.space_after = Pt(10)


def caption(text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(p.add_run(text), name="黑体", size=12)


# =====================================================================
chapter("1 问题定义")

section("1.1 项目背景与意义")
para("当代高校与职场中的聚会场景普遍存在一个矛盾：参加者彼此并不熟悉，而传统破冰环节"
     "要么依赖主持人个人经验，要么停留在自我介绍层面，难以真正降低社交门槛。已有的聚会类"
     "应用多以单机小游戏为主，缺少“同一房间、同一进度、同时参与”的多人协作体验，组织者"
     "还需要额外承担记分、控场和流程调度的工作。")
para("本项目以“房间”为核心组织单位，设计并实现了一款微信小程序《破冰局》。用户创建房间"
     "后通过房间号或二维码邀请同伴加入，全员准备后由房主选择玩法，所有人同时进入同一局游戏，"
     "结束后回到大厅即可再来一局。系统内置四种玩法：谁是卧底、你画我猜、你画我猜谁是卧底、"
     "真心话大冒险，并提供雪人形象自定义、积分结算与自定义题库等配套功能。")
sub("1.1.1 NABCD 分析")
para("Need（需求）：聚会场景缺少低门槛、可多人同时参与的破冰工具；组织者缺少自动控场与"
     "计分手段；陌生成员缺少可视化身份，容易记混人名。")
para("Approach（做法）：以房间为唯一组织单位统一四个玩法；用微信小程序承载，扫码即用、"
     "无需安装；把游戏规则放到服务端执行，保证多端一致且不可篡改。")
para("Benefit（收益）：组织者只需建房、选玩法，流程与计分全自动；参与者扫一次码即可加入，"
     "雪人形象与座位号让陌生人之间也能快速区分彼此。")
para("Competition（竞争）：与通用聚会游戏相比，本项目的差异在于“房间级流程”和“多玩法"
     "共用一套房间状态”，不是孤立的小游戏集合；与线下纸笔方式相比，省去了道具与人工记分。")
para("Delivery（推广）：以班级、社团、团队建设等小规模场景切入，通过房间号与二维码在微信群"
     "内传播，无需额外推广成本。")

section("1.2 项目基本目标")
para("系统需实现以下目标：")
bullets([
    "房间全流程：创建、加入、准备、开局、结算、返回大厅，全流程在移动端完成。",
    "多玩法共存：四种玩法共用同一套房间状态与成员体系，可在同一房间内连续切换。",
    "多端实时一致：同一房间内所有设备的题目、进度、画板与投票结果保持一致。",
    "服务端权威：游戏规则与胜负判定在服务端执行，客户端无法通过修改本地数据作弊。",
    "可配置内容：支持自建题库并指定给对应玩法使用。",
    "异常可用：网络抖动、成员中途退出、AI 服务不可用时，游戏流程仍能继续。",
])

section("1.3 可行性分析")
para("技术可行性：前端采用 uni-app + Vue 3 + TypeScript，一套代码可同时产出微信小程序与 H5；"
     "后端采用 Supabase 提供的 PostgreSQL、行级权限、对象存储与实时通道，并配合 Deno 编写的"
     "Edge Functions 承载游戏规则，均为成熟且文档完善的技术选型。")
para("经济可行性：小程序开发与发布免费；Supabase 免费额度足以支撑课程项目与小规模试用；"
     "除可选的 AI 评分接口外无额外服务成本。")
para("操作可行性：目标用户为普通微信用户，交互沿用小程序习惯，扫码即可加入，学习成本接近于零。")
para("进度可行性：项目按模块并行开发，四个模块接口在前期即约定完成，具备在课程周期内交付的条件。")

section("1.4 人员管理和项目进度管理")
para("项目按功能模块划分责任，同时约定统一的房间与数据接口，各模块并行开发后由集成负责人"
     "统一联调。分工如下表所示。")
caption("表 1-1 小组成员分工")
table(
    ["成员", "负责模块", "主要工作"],
    [
        ["成员 A", "后端与数据层", "数据库表结构、行级权限、存储、实时通道、登录鉴权与云函数基础设施"],
        ["成员 B", "你画我猜模块", "画布引擎、笔画同步、计分规则、AI 评分接入"],
        ["成员 C", "谁是卧底模块", "游戏引擎、规则判定、题库与词对管理"],
        ["成员 D（本人）", "大厅与房间、形象系统、整合联调", "房间全流程与界面、雪人形象系统、四模块集成、视觉统一、测试与文档"],
    ],
    [2.6, 4.2, 8.6],
)
para("进度安排上，第 1—2 周完成需求分析与接口约定；第 3—5 周各模块并行开发；第 6—7 周"
     "集成联调与缺陷修复；第 8 周进行真机验收、文档整理与提交。项目使用 Gitee 进行版本管理，"
     "主分支保持可运行状态，功能分支合并前需通过类型检查与自动化测试。")

# ---------------------------------------------------------------------
chapter("2 需求分析")

section("2.1 需求分析概述")
para("系统面向两类角色：房主与普通参与者。房主承担开局、选玩法与结束本局的职责，普通参与者"
     "负责准备、参与游戏与投票。两类角色的功能需求如下表。")
caption("表 2-1 功能需求列表")
table(
    ["编号", "功能", "说明", "角色"],
    [
        ["F1", "创建房间", "生成 6 位房间号，可设置房间名称与人数上限", "全体"],
        ["F2", "加入房间", "通过房间号或扫描二维码加入", "全体"],
        ["F3", "准备状态", "成员各自准备，全员准备后房主方可开局", "全体"],
        ["F4", "选择玩法", "房主在四种玩法中选择一种开始", "房主"],
        ["F5", "谁是卧底", "领词、轮流描述、投票、平票加赛与结算", "全体"],
        ["F6", "你画我猜", "轮流出题作画、他人实时观看并抢答、按积分排名", "全体"],
        ["F7", "你画我猜谁是卧底", "共用画板接力作画，轮末依次展示并投票", "全体"],
        ["F8", "真心话大冒险", "共享题目回合，全员看到同一题，完成或跳过", "全体"],
        ["F9", "形象与身份", "自定义雪人形象与昵称，房间内以座位号区分同名", "全体"],
        ["F10", "结算与榜单", "对局结算、积分排名与颁奖台展示", "全体"],
        ["F11", "自定义题库", "自建题库并指定给对应玩法使用", "全体"],
        ["F12", "人机补位", "人数不足时由房主确认后补充人机", "房主"],
    ],
    [1.4, 3.2, 8.6, 2.2],
)
para("非功能需求包括：主包体积不超过 2 MB；房间状态同步延迟不超过 2 秒；游戏规则与计分在"
     "服务端完成；不同房间之间数据严格隔离；任一端异常退出不得阻塞其余成员。")

section("2.2 UML相关需求分析图")
para("系统的核心用例可归纳为“房间管理”与“游戏进行”两簇。房间管理包含创建房间、加入房间、"
     "准备、开始游戏与结束本局；游戏进行包含各自的玩法操作，并统一以“进入游戏—操作—结算—"
     "返回大厅”为主线。")
para("参与者与用例的关系为：房主可执行全部房间管理用例并参与游戏；普通成员可执行加入、准备"
     "与游戏内操作；人机由服务端驱动，仅响应必要的领词、结束回合与投票动作。")
placeholder("D", "补充用例图与活动图（建议用 Visio 或 StarUML 绘制：房间主流程活动图、卧底投票活动图）")

section("2.3 原型系统设计")
para("原型围绕“一屏一任务”的原则设计：首页只承担形象编辑与进入房间两件事；房间页集中展示"
     "房间号、成员列表与主操作按钮；游戏页按当前阶段只呈现该阶段需要的操作，避免同时暴露"
     "过多信息。")
para("视觉上采用浅蓝色主色与白色卡片的组合，所有页面共享一套设计变量（主色、圆角、阴影、"
     "文字层级），保证四个模块的界面风格统一。")
para("主要界面如下图所示：首页负责形象编辑与进入房间；创建页只需填写房间名称与人数；"
     "加入页输入房间号即可进入；房间页集中展示房间号、二维码、成员与准备状态，并承载主持人的开局入口。")
figures([
    ("87116DAABB8AA052BA445E1FB1FEB6A9.png", "图 2-1 首页：雪人形象与入口"),
    ("4476591C6742B0491D57FB8D9476D66B.png", "图 2-2 创建房间"),
])
figures([
    ("A2E9EBA892FED853F91D9842D7501A92.png", "图 2-3 加入房间"),
    ("7A83735AA86EBAB25E9764BE05E3721E.png", "图 2-4 房间大厅"),
], 7.0)

# ---------------------------------------------------------------------
chapter("3 概要设计和详细设计")

section("3.1 系统结构")
para("系统采用四层结构，自下而上依次为存储层、平台适配层、业务逻辑层与表示层。")
bullets([
    "表示层：小程序页面与通用组件，负责渲染与交互，不直接访问数据库。",
    "业务逻辑层：房间状态机、各玩法适配器与计分模块，负责流程推进与规则判定。",
    "平台适配层：以 RoomApi 接口统一后端能力，提供“联机实现”与“内存实现”两套实现。",
    "存储层：PostgreSQL（含行级权限）、对象存储与实时通道。",
])
para("平台适配层的引入使同一套业务代码既可以在联机环境运行，也可以在无网络的内存环境下运行，"
     "后者被大量用于自动化测试，显著降低了联调成本。")

sub("3.1.1 功能说明")
para("房间状态机定义了 lobby 与 playing 两种状态及其迁移条件：创建房间进入 lobby；全员准备"
     "且房主开局后进入 playing；对局自然结束时房间仍保持 playing，以便参与者随时回到结算界面；"
     "仅当房主显式“结束本局”时才回到 lobby 并清空全部准备状态。")
para("该设计解决了“结束后被强制退出”和“退出后又被自动拉回”两类问题：前者由“结束不自动收尾”"
     "保证，后者由“主动退出标记”保证。")

sub("3.1.2 接口设计")
para("系统对外接口以服务端函数与数据接口两类形式提供。房间相关接口包括创建、加入、准备、"
     "心跳、开始与结束；游戏相关接口以统一的指令入口承载，由服务端根据操作类型分发到对应玩法"
     "的规则处理。所有接口均要求已登录身份，并在服务端再次校验调用者是否为该房间成员或房主。")
placeholder("A", "补充接口清单与参数说明（房间、对局、画作、评分四组接口的请求/响应字段表）")

section("3.2 类图等")
para("前端核心类型包括：房间（Room）、成员（Member）、对局视图（各类 View）、画作（Artwork）"
     "与评分（Score）。房间与成员为一对多关系；一局对局属于一个房间；画作属于某局对局的某一轮，"
     "并归属于提交它的玩家；评分与画作一对一。")
para("服务端以“对局状态 + 版本号”作为唯一真相：客户端所有操作携带期望版本号，服务端校验通过后"
     "递增版本并写回，保证并发操作下的顺序一致。")
placeholder("B、C", "补充你画我猜与谁是卧底模块的类图（引擎、状态、事件三类的关系）")

section("3.3 关键数据结构定义")
para("核心数据表及其作用如下表。")
caption("表 3-1 核心数据结构")
table(
    ["表名", "作用", "关键字段"],
    [
        ["rooms", "房间", "id、code（6 位房间号）、host_id、status、game_type、settings"],
        ["room_members", "房间成员", "room_id、user_id、seat（座位号）、ready、left_at"],
        ["games", "一局对局", "id、room_id、variant、status、version、state、view"],
        ["game_secrets", "私有词牌", "game_id、user_id、word、camp"],
        ["artworks", "画作", "game_id、turn_key、user_id、storage_path、status"],
        ["ai_scores", "AI 评分", "artwork_id、total、comment、ai_guess、ai_seconds"],
        ["profiles", "用户资料", "id、nickname、avatar（雪人分层）、mbti"],
    ],
    [3.4, 4.0, 8.0],
)
para("其中 rooms.settings 以 JSON 存储房间级配置；games.state 保存服务端权威的对局状态，"
     "games.view 保存下发给客户端的公开视图，二者分离以保证私有信息（如他人词牌）不会泄露。")

section("3.4 关键算法设计")
sub("3.4.1 胜负判定（D 参与修正）")
para("谁是卧底的胜负判定按“卧底阵营全部出局则平民胜；平民全部出局则卧底胜；仅剩两人且为"
     "一平民一卧底时卧底胜”三条规则执行。早期实现采用“存活人数不超过 3 即卧底胜”的经验规则，"
     "会导致四人局中一人出局便结束游戏，现已按上述规则修正，并由单元测试锁定。")
sub("3.4.2 平票加赛与投票权")
para("出现最高票并列时进入加赛，仅候选人有发言资格；投票权原先错误地将候选人排除在外，"
     "导致四人全平票时无人可投、全部弃权。修正后候选人与其他存活玩家同样具备投票权，但可选目标"
     "限定为候选人。")
sub("3.4.3 接力作画与实时同步")
para("你画我猜谁是卧底采用“共用画板、按序接力”的方式：每位玩家在自己回合内于前一位的笔迹上继续"
     "作画，提交后形成一份快照，作品键由“轮次 + 玩家”构成，保证同轮多份快照互不覆盖。为保证观战端"
     "与作画端一致，笔画以分片广播传输，同时观战端每 2 秒请求一次全量快照，用于丢片后的自愈。")
sub("3.4.4 AI 评分映射")
para("AI 评分把“识别结果 + 用时”映射为 0—100 分：猜中时以 80 为基数、按用时线性加速至 100；"
     "未猜中时以 80 为基数、按用时线性衰减至 0。该映射为纯函数，客户端展示与服务端计分共用同一套"
     "口径，并有边界用例覆盖。")

section("3.5 数据管理说明")
para("系统数据分布在三类存储中：结构化数据存于 PostgreSQL，通过行级权限保证不同房间、不同用户"
     "之间的隔离；画作等二进制文件存于对象存储，采用私有桶加签名地址的方式访问；实时消息通过"
     "实时通道广播，仅用于提示刷新，不作为数据真相。")
para("所有数据库变更以迁移脚本管理，共 26 支，按编号顺序执行，脚本均为幂等设计，重复执行不会"
     "破坏已有数据。回退脚本与备份方案单独记录于项目文档。")
placeholder("A", "补充数据库 E-R 图与迁移清单")

# ---------------------------------------------------------------------
chapter("4 实现与测试")

section("4.1 实现环境与代码管理")
para("开发环境为 Windows，前端使用 Node.js + Vite 构建，微信开发者工具负责真机预览与调试；"
     "后端使用 Supabase 云服务，云函数以 TypeScript 编写并部署至 Edge Functions 运行时。")
para("代码托管于 Gitee（https://gitee.com/amadys/break-ice-hall），采用功能分支开发、主分支保持"
     "可运行的策略，累计提交 175 次。提交前统一执行类型检查、单元测试与构建校验，构建产物与源码"
     "不一致时会直接拦截。")
para("图 4-1 为 Gitee 仓库的提交记录，可见项目按功能分支开发、逐条提交并保留说明。")
figures([("4-1.png", "图 4-1 码云平台代码提交记录")], 13.5)

section("4.2 关键函数说明")
para("前端的核心函数包括：房间状态的订阅与刷新（负责按固定间隔与实时事件刷新房间数据）、"
     "游戏入口判定（根据房间状态决定进入哪个玩法）、画布提交（导出画布并上传后登记画作）、"
     "接力起点装载（把前一位玩家的笔迹作为本回合的初始状态）。")
para("后端核心函数包括：开局（校验人数与准备状态、生成词牌与初始状态）、操作提交（校验版本、"
     "应用规则、写回状态）、时钟推进（按截止时间推进阶段）、结算（写积分并结束对局）。")
placeholder("B、C", "补充各模块关键函数清单与调用关系图")

section("4.3 测试计划和测试用例")
para("测试分为三层：单元测试覆盖房间状态机、游戏引擎、计分规则、形象组合与平台层；后端验收脚本"
     "直接调用真实接口，验证对局全流程、权限隔离与幂等；真机联调使用两台设备模拟真实使用场景。")
para("截至提交，单元测试共 313 个、全部通过；后端验收脚本 6 套，分别覆盖对局流程 19 项、权限"
     "与隔离 12 项、画作与评分 8 项、你画我猜会话 9 项、真心话 5 项、小程序码 3 项。")
caption("表 4-1 主要测试用例（节选）")
table(
    ["编号", "测试项", "操作", "预期结果"],
    [
        ["T1", "房间全流程", "建房→加入→准备→开局→结束", "各端状态一致，结束后回到大厅且全员未准备"],
        ["T2", "权限隔离", "用其他房间账号读取本房数据", "拒绝访问，不泄露任何房间数据"],
        ["T3", "平票加赛", "四人全部平票", "进入加赛且候选人可投票"],
        ["T4", "四人局出局判定", "投出一名平民", "游戏继续，直到剩两人或平民出尽"],
        ["T5", "退出与回到游戏", "成员中途退出后再进入", "房间保持进行中，可回到结算界面"],
        ["T6", "接力作画", "两位玩家先后作画并提交", "同轮出现两份快照，后一位在前一位基础上继续"],
        ["T7", "丢片自愈", "观看端切换前后台造成丢片", "2 秒内补齐画布内容"],
        ["T8", "AI 评分", "提交画作并触发评分", "分数落库，画廊显示识别结果与用时"],
        ["T9", "自定义题库", "建库并选用后开局", "抽到的词来自所选题库"],
        ["T10", "人机补位", "两人开局选择补人机", "补至四人并可正常完成一局"],
    ],
    [1.4, 3.4, 5.0, 6.6],
)

section("4.4 结果分析")
para("上述测试全部通过，系统满足需求分析中提出的功能与非功能要求：房间流程完整可用，四种玩法"
     "均可完成一局并正确结算；跨房间数据隔离有效；异常退出、丢片与服务不可用等场景均有降级策略。")
para("下图为本轮验收时各玩法的实际界面：谁是卧底的领词、发言与投票，你画我猜的作画、观战与结算，"
     "以及你画我猜谁是卧底的作画与轮末回顾。")
figures([
    ("0B42CEF9C77317AD65BF04D62B94A09C.png", "图 4-2 谁是卧底：领词"),
    ("91A2DF7B0A3485CE951AB53B02EA8237.png", "图 4-3 谁是卧底：发言"),
], 7.0)
figures([
    ("647E831AC9E3E45BC4D8930038022C92.png", "图 4-4 谁是卧底：投票"),
    ("FBB301FAB62AA51CDFCB980828F0A629.png", "图 4-5 谁是卧底：他人观战视角"),
], 7.0)
figures([
    ("249830310CA57689EE90CFF71271D024.png", "图 4-6 你画我猜：作画"),
    ("86CC90FE202FFEB857AC08447C2D6E26.png", "图 4-7 你画我猜：观战"),
], 7.0)
figures([
    ("8A282D4D2508E8F804B292D8749886E1.png", "图 4-8 你画我猜：结算与画廊"),
    ("6CBFB35EF3CC03B97618B61276A49BD2.png", "图 4-9 真心话大冒险"),
], 7.0)
figures([
    ("4526AD5D549612CBA32706FDEECEAA73.png", "图 4-10 融合玩法：接力作画"),
    ("4F8389193CFED3A3FFD669FD2CF5482D.png", "图 4-11 融合玩法：轮末回顾与投票"),
], 7.0)

para("测试过程中也暴露出若干设计缺陷，均已完成修复并补充回归用例，典型问题包括：服务端开局未写入"
     "玩法字段导致其他成员无法进入；对局结束即清空房间状态导致结算界面无法回看；画作唯一键粒度过粗"
     "导致同轮多份画作互相覆盖；评分写入列名错误且未校验返回值导致“测试通过但数据未落库”。")

# ---------------------------------------------------------------------
chapter("5 总结")

section("5.1 用户反馈")
para("项目在小组内部与同学之间进行了多轮试用，累计完成四轮真机联调。反馈集中在三点：扫码加入的"
     "流程顺畅，陌生人之间靠雪人形象与座位号能够快速区分；四种玩法切换自然，不需要重新建房；"
     "结算界面与颁奖台提升了完成感。改进建议集中在网络不稳定时的同步表现与部分界面细节。")
placeholder("D", "补充用户反馈材料（使用照片、聊天记录截图、试用人数统计）")

section("5.2 全文总结")
para("本项目完成了从需求分析、概要设计、详细设计到编码、测试与验收的完整软件工程过程，交付了一款"
     "可在微信中直接使用的多人在线聚会小程序。系统以房间为核心组织单位，把四种玩法统一到同一套"
     "房间状态与成员体系之下，并通过服务端权威的规则执行保证多端一致与公平性。")
para("作为集成负责人，本人的主要工作包括：房间全流程与大厅界面的设计与实现、雪人形象系统、四个"
     "模块的接口对齐与联调、视觉体系统一，以及测试组织与文档整理。")

# ---------------------------------------------------------------------
chapter("6 体会")
para("本部分由每位成员分别撰写，重点描述自己在开发中遇到的困难与解决方式。")
sub("成员 D（大厅与房间、形象系统、整合）")
para("整合阶段最大的困难不是写新代码，而是三个模块各自假设了一套运行模型：有的以“一局游戏”为"
     "中心，有的是纯单机，有的同时提供了房间与对局两套表。把它们接起来的第一步不是编码，而是确定"
     "“房间是唯一组织单位”，并抽出一层平台接口让业务代码与后端解耦。这一层后来也成了测试的基础——"
     "没有网络时可以用内存实现跑完整流程。")
para("第二个体会是“错误必须可见”。项目中后期出现的几个疑难问题，共同点都是失败被静默吞掉：服务端"
     "返回的错误被截断、写库失败没有检查返回值、客户端读到空值直接返回而不提示。把错误改成带原因的"
     "显式提示后，同样的问题往往几分钟就能定位。")
para("第三个体会来自多次“修一个坏一个”的经历。结算页常驻、退出不被拉回这类需求涉及服务端状态与多端"
     "跳转，改动一处很容易影响另一处。后来我们约定：这类改动先补回归测试再动手，并要求构建产物与源码"
     "不一致时直接拦截，才逐渐稳下来。")
placeholder("A", "成员 A 的体会（后端与数据层：数据库设计、权限与并发控制的经验）")
placeholder("B", "成员 B 的体会（你画我猜：画布与实时同步、AI 评分的取舍）")
placeholder("C", "成员 C 的体会（谁是卧底：规则实现与边界情况的处理）")

# ---------------------------------------------------------------------
chapter("附录")
para("附录收录关键源代码与配置说明，源码以 Gitee 仓库为准：https://gitee.com/amadys/break-ice-hall")
para("仓库结构：app/src 为小程序前端源码；supabase/migrations 为数据库迁移脚本；"
     "supabase/functions 为云函数；docs 为设计与验收文档。")
placeholder("A、B、C、D", "如需附代码清单，请各自挑选 1—2 个关键文件粘贴于此（宋体 5 号）")

# ---- 目录：删除模板里写死的条目，插入可更新的 TOC 域 ----
from docx.oxml import OxmlElement

toc_paras = [p for p in doc.paragraphs if p.style.name.lower().startswith("toc")]
if toc_paras:
    anchor_el = toc_paras[0]._element
    for p in toc_paras:
        p._element.getparent().remove(p._element)
    holder = doc.add_paragraph()
    anchor_el.addnext(holder._element)
    run = holder.add_run()
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), 'TOC \\o "1-3" \\h \\z \\u')
    inner = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = "右键此处选择“更新域”生成目录"
    inner.append(t)
    fld.append(inner)
    holder._element.append(fld)

doc.save(DST)
print("saved", DST)
