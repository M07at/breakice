"""生成 draw.io（.drawio）文件：用例图 + 两张活动图，可在 app.diagrams.net 或桌面版直接编辑。"""
import sys
import uuid
from xml.sax.saxutils import escape

OUT_DIR = r"D:\1\break-ice-hall\docs\报告\diagrams"

HEADER = (
    '<mxfile host="app.diagrams.net" type="device">\n'
    '  <diagram id="d{idx}" name="{name}">\n'
    '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" '
    'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{pw}" pageHeight="{ph}" '
    'math="0" shadow="0">\n'
    '      <root>\n'
    '        <mxCell id="0" />\n'
    '        <mxCell id="1" parent="0" />\n'
)
FOOTER = "      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n"


class Graph:
    def __init__(self, name, idx, width=1200, height=900):
        self.name = name
        self.idx = idx
        self.width = width
        self.height = height
        self.cells = []
        self.n = 0

    def _id(self, prefix="c"):
        self.n += 1
        return f"{prefix}{self.n}"

    def vertex(self, value, x, y, w, h, style):
        cid = self._id()
        self.cells.append(
            f'        <mxCell id="{cid}" value="{escape(value)}" style="{style}" vertex="1" parent="1">\n'
            f'          <mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry" />\n'
            f"        </mxCell>\n"
        )
        return cid

    def box(self, value, x, y, w=220, h=60, fill="#E9F1FF", stroke="#4F8EF7"):
        style = (
            f"rounded=1;whiteSpace=wrap;html=1;arcSize=18;fillColor={fill};strokeColor={stroke};"
            "strokeWidth=1.5;fontSize=13;fontColor=#172033;"
        )
        return self.vertex(value, x, y, w, h, style)

    def start(self, x, y, label="开始"):
        style = "ellipse;whiteSpace=wrap;html=1;fillColor=#E7F8F4;strokeColor=#0F9F87;strokeWidth=1.5;fontSize=13;"
        return self.vertex(label, x, y, 110, 50, style)

    def decision(self, value, x, y, w=180, h=90):
        style = (
            "rhombus;whiteSpace=wrap;html=1;fillColor=#FFF7E0;strokeColor=#D97706;strokeWidth=1.5;"
            "fontSize=13;fontColor=#172033;"
        )
        return self.vertex(value, x, y, w, h, style)

    def actor(self, value, x, y):
        style = "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;fontSize=13;"
        return self.vertex(value, x, y, 60, 110, style)

    def usecase(self, value, x, y, w=220, h=70):
        style = "ellipse;whiteSpace=wrap;html=1;fillColor=#E9F1FF;strokeColor=#4F8EF7;strokeWidth=1.5;fontSize=13;"
        return self.vertex(value, x, y, w, h, style)

    def boundary(self, value, x, y, w, h):
        style = (
            "swimlane;whiteSpace=wrap;html=1;startSize=30;fillColor=#F8FAFF;strokeColor=#94A3B8;"
            "dashed=1;fontSize=14;"
        )
        return self.vertex(value, x, y, w, h, style, )

    def edge(self, src, dst, label="", dashed=False, exit=None, entry=None):
        cid = self._id("e")
        style = "endArrow=block;html=1;rounded=0;strokeWidth=1.4;strokeColor=#334155;fontSize=12;"
        if dashed:
            style += "dashed=1;"
        if exit:
            style += f"exitX={exit[0]};exitY={exit[1]};exitDx=0;exitDy=0;"
        if entry:
            style += f"entryX={entry[0]};entryY={entry[1]};entryDx=0;entryDy=0;"
        self.cells.append(
            f'        <mxCell id="{cid}" value="{escape(label)}" style="{style}" edge="1" parent="1" '
            f'source="{src}" target="{dst}">\n'
            f'          <mxGeometry relative="1" as="geometry" />\n'
            f"        </mxCell>\n"
        )
        return cid

    def save(self, path):
        body = HEADER.format(idx=self.idx, name=escape(self.name), pw=self.width, ph=self.height)
        body += "".join(self.cells)
        body += FOOTER
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(body)


# ---------------------------------------------------------------- 1 用例图
g = Graph("用例图", 1, 1180, 900)
g.boundary("破冰局小程序", 330, 90, 560, 720)
host = g.actor("房主", 120, 330)
user = g.actor("普通参与者", 980, 330)

rows = [
    (140, "创建 / 加入房间", "玩谁是卧底"),
    (300, "准备 / 取消准备", "玩你画我猜"),
    (460, "选择玩法并开局", "玩融合玩法"),
    (620, "结束本局（仅房主）", "真心话大冒险"),
]
created = []
for y, left, right in rows:
    lc = g.usecase(left, 390, y)
    rc = g.usecase(right, 670, y)
    created.append((y, lc, rc))

for y, lc, _ in created:
    g.edge(host, lc, entry=(0, 0.5), exit=(1, 0.5))
for y, _, rc in created:
    g.edge(user, rc, entry=(1, 0.5), exit=(0, 0.5))

g.save(OUT_DIR + r"\01-用例图.drawio")

# ---------------------------------------------------------------- 2 房间主流程
g = Graph("房间主流程活动图", 2, 1000, 1500)
x = 380
y = 60
prev = g.start(x + 55, y, "开始")
steps = [
    "进入小程序首页：编辑雪人形象与昵称",
    "选择：创建房间 / 加入房间",
    "进入房间大厅（status = lobby）",
    "每位成员点击「我准备好了」",
]
for text in steps:
    y += 110
    cur = g.box(text, x, y, 240, 60)
    g.edge(prev, cur)
    prev = cur

y += 130
d1 = g.decision("全员准备？", x + 20, y, 200, 90)
g.edge(prev, d1)
wait = g.box("继续等待（否）", x + 300, y + 15, 160, 50, fill="#FFF7E0", stroke="#D97706")
g.edge(d1, wait, "否", exit=(1, 0.5), entry=(0, 0.5))

y += 140
cur = g.box("房主选择玩法", x, y, 240, 60)
g.edge(d1, cur, "是", exit=(0.5, 1), entry=(0.5, 0))

y += 110
cur2 = g.box("房间 status = playing，所有人进入游戏", x - 60, y, 360, 60)
g.edge(cur, cur2)

y += 110
cur = g.box("一局自然结束：停在结算页", x, y, 240, 60)
g.edge(cur2, cur)

y += 110
d2 = g.decision("房主结束本局？", x + 20, y, 200, 90)
g.edge(cur, d2)

y += 140
cur = g.box("status = lobby，全员准备清零", x - 30, y, 300, 60)
g.edge(d2, cur, "是", exit=(0.5, 1), entry=(0.5, 0))

y += 110
end = g.start(x + 55, y, "结束")
g.edge(cur, end)

stay = g.box("结算页常驻（否）", x + 300, y - 250, 180, 50, fill="#FFF7E0", stroke="#D97706")
g.edge(d2, stay, "否", exit=(1, 0.5), entry=(0, 0.5))
g.save(OUT_DIR + r"\02-房间主流程活动图.drawio")

# ---------------------------------------------------------------- 3 卧底投票
g = Graph("谁是卧底投票活动图", 3, 1050, 1250)
x = 360
y = 60
prev = g.start(x + 55, y, "开始")
flow = [
    "本轮发牌：为每位玩家发放词牌",
    "幸存玩家依次发言（不可直接报出词语）",
    "全体投票（候选人同样有投票权）",
]
for text in flow:
    y += 110
    cur = g.box(text, x - 40, y, 320, 60)
    g.edge(prev, cur)
    prev = cur

y += 130
d1 = g.decision("最高票并列？", x + 20, y)
g.edge(prev, d1)
out = g.box("票数最高者出局", x + 300, y + 20, 180, 60)
g.edge(d1, out, "否", exit=(1, 0.5), entry=(0, 0.5))

y += 140
pk = g.box("进入加赛：候选人补充发言后投票", x - 140, y, 300, 60)
g.edge(d1, pk, "是", exit=(0.5, 1), entry=(0.5, 0))
out2 = g.box("最高票出局（再平票无人出局）", x + 220, y, 260, 60)
g.edge(pk, out2)

y += 110
judge = g.box("判定胜负：卧底出尽→平民胜；平民出尽或仅剩两人→卧底胜", x - 200, y, 440, 70)
g.edge(out, judge)
g.edge(out2, judge)

y += 120
d2 = g.decision("游戏结束？", x + 20, y)
g.edge(judge, d2)
end = g.start(x + 55, y + 140, "结束")
g.edge(d2, end, "是", exit=(0.5, 1), entry=(0.5, 0))
again = g.box("进入下一轮（回到发牌）", x + 300, y + 25, 200, 60)
g.edge(d2, again, "否", exit=(1, 0.5), entry=(0, 0.5))
g.save(OUT_DIR + r"\03-卧底投票活动图.drawio")

print("drawio files written")
