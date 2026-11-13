"""用 Pillow 画用例图与两张活动图（供在 Visio 中重绘）。"""
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = r"C:\Windows\Fonts\msyh.ttc"
OUT = r"D:\1\break-ice-hall\docs\报告\diagrams"
BRAND = (79, 142, 247)
INK = (23, 32, 51)
MUTED = (100, 116, 139)
SOFT = (233, 241, 255)
WHITE = (255, 255, 255)
AMBER = (217, 119, 6)
AMBER_SOFT = (255, 247, 224)


def f(size):
    return ImageFont.truetype(FONT_PATH, size)


def center(draw, box, text, size=20, color=INK):
    lines = text.split("\n")
    heights = [draw.textbbox((0, 0), line, font=f(size))[3] for line in lines]
    total = sum(heights) + (len(lines) - 1) * 6
    y = box[1] + (box[3] - box[1] - total) / 2
    for line, h in zip(lines, heights):
        w = draw.textbbox((0, 0), line, font=f(size))[2]
        draw.text((box[0] + (box[2] - box[0] - w) / 2, y - draw.textbbox((0, 0), line, font=f(size))[1]), line, font=f(size), fill=color)
        y += h + 6


def rbox(draw, box, text, fill=SOFT, outline=BRAND, size=20, radius=14):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=3)
    center(draw, box, text, size)


def ellipse(draw, box, text, size=19):
    draw.ellipse(box, fill=SOFT, outline=BRAND, width=3)
    center(draw, box, text, size)


def diamond(draw, box, text, size=18):
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    draw.polygon([(cx, y0), (x1, cy), (cx, y1), (x0, cy)], fill=AMBER_SOFT, outline=AMBER, width=3)
    center(draw, box, text, size)


def arrow(draw, start, end, dashed=False, label=None, size=17):
    if dashed:
        # 简单虚线
        import math
        dx, dy = end[0] - start[0], end[1] - start[1]
        dist = math.hypot(dx, dy)
        steps = max(1, int(dist // 14))
        for i in range(steps):
            if i % 2:
                continue
            a = (start[0] + dx * i / steps, start[1] + dy * i / steps)
            b = (start[0] + dx * (i + 1) / steps, start[1] + dy * (i + 1) / steps)
            draw.line([a, b], fill=MUTED, width=2)
    else:
        draw.line([start, end], fill=(51, 65, 85), width=3)
    # 箭头
    import math
    ang = math.atan2(end[1] - start[1], end[0] - start[0])
    L = 13
    p1 = (end[0] - L * math.cos(ang - 0.4), end[1] - L * math.sin(ang - 0.4))
    p2 = (end[0] - L * math.cos(ang + 0.4), end[1] - L * math.sin(ang + 0.4))
    draw.polygon([end, p1, p2], fill=(51, 65, 85))
    if label:
        draw.text(((start[0] + end[0]) / 2 + 8, (start[1] + end[1]) / 2 - 12), label, font=f(size), fill=MUTED)


# ---------------------------------------------------------------- 用例图
W, H = 1500, 1060
img = Image.new("RGB", (W, H), WHITE)
d = ImageDraw.Draw(img)
d.rounded_rectangle((380, 150, 1120, 940), radius=10, outline=(148, 163, 184), width=2)
d.text((690, 110), "破冰局小程序", font=f(24), fill=MUTED)

for cx, name in ((170, "房主"), (1330, "普通参与者")):
    d.ellipse((cx - 22, 320, cx + 22, 364), fill=WHITE, outline=INK, width=3)
    d.line((cx, 364, cx, 440), fill=INK, width=3)
    d.line((cx - 40, 390, cx + 40, 390), fill=INK, width=3)
    d.line((cx, 440, cx - 32, 490), fill=INK, width=3)
    d.line((cx, 440, cx + 32, 490), fill=INK, width=3)
    w = d.textbbox((0, 0), name, font=f(22))[2]
    d.text((cx - w / 2, 510), name, font=f(22), fill=INK)

rows = [
    (250, "创建 / 加入房间", "玩谁是卧底"),
    (420, "准备 / 取消准备", "玩你画我猜"),
    (590, "选择玩法并开局", "玩融合玩法"),
    (760, "结束本局（仅房主）", "真心话大冒险"),
]
for y, left_text, right_text in rows:
    ellipse(d, (420, y, 720, y + 92), left_text, 18)
    ellipse(d, (790, y, 1090, y + 92), right_text, 18)

for y, _, _ in rows[:3]:
    arrow(d, (214, 400), (418, y + 46))
arrow(d, (214, 420), (418, 806))

for y, _, _ in rows:
    arrow(d, (1286, 400), (1092, y + 46))

d.text((300, 990), "说明：「结束本局」只有房主可执行；人机由服务端驱动，不单独建模。",
       font=f(18), fill=MUTED)
img.save(OUT + r"\01-用例图.png")

# ---------------------------------------------------------------- 活动图：房间主流程
W, H = 1100, 1780
img = Image.new("RGB", (W, H), WHITE)
d = ImageDraw.Draw(img)
cx = 550
ys = 130
steps = [
    "进入小程序首页：编辑雪人形象与昵称",
    "选择：创建房间 / 加入房间",
    "进入房间大厅（status = lobby）",
    "每位成员点击「我准备好了」",
]
for text in steps:
    rbox(d, (cx - 300, ys, cx + 300, ys + 80), text, size=21)
    arrow(d, (cx, ys + 80), (cx, ys + 150))
    ys += 150

diamond(d, (cx - 200, ys, cx + 200, ys + 140), "全员准备？", 20)
d.text((cx + 220, ys + 55), "否：继续等待", font=f(19), fill=AMBER)
arrow(d, (cx, ys + 140), (cx, ys + 210))
ys += 210

rbox(d, (cx - 300, ys, cx + 130, ys + 80), "房主选择玩法", size=21)
rbox(d, (cx + 150, ys, cx + 380, ys + 80), "人数不足时可补人机", fill=WHITE, outline=(203, 213, 225), size=17)
arrow(d, (cx + 20, ys + 80), (cx, ys + 150))
ys += 150

rbox(d, (cx - 300, ys, cx + 300, ys + 80), "房间 status = playing，所有人进入游戏", size=21)
arrow(d, (cx, ys + 80), (cx, ys + 150))
ys += 150

rbox(d, (cx - 300, ys, cx + 300, ys + 80), "一局自然结束：停在结算页", size=21)
d.text((cx + 330, ys + 20), "房间仍是 playing\n可随时「回到游戏」", font=f(17), fill=MUTED)
arrow(d, (cx, ys + 80), (cx, ys + 150))
ys += 150

diamond(d, (cx - 220, ys, cx + 220, ys + 140), "房主结束本局？", 20)
d.text((cx + 240, ys + 55), "否：结算页常驻", font=f(19), fill=AMBER)
arrow(d, (cx, ys + 140), (cx, ys + 210), label="是")
ys += 210

rbox(d, (cx - 320, ys, cx + 320, ys + 80), "status = lobby，全员准备状态清零", size=21)
arrow(d, (cx, ys + 80), (cx, ys + 150))
ys += 150
rbox(d, (cx - 240, ys, cx + 240, ys + 80), "所有人回到大厅（结束）", fill=WHITE, outline=(148, 163, 184), size=21)
img.save(OUT + r"\02-房间主流程活动图.png")

# ---------------------------------------------------------------- 活动图：卧底投票
W, H = 1150, 1560
img = Image.new("RGB", (W, H), WHITE)
d = ImageDraw.Draw(img)
cx = 575
ys = 110

rbox(d, (cx - 320, ys, cx + 320, ys + 80), "本轮开始：为每位玩家发放词牌", size=21)
ys += 150
rbox(d, (cx - 340, ys, cx + 340, ys + 80), "幸存玩家依次发言（不可直接报出词语）", size=21)
ys += 150
rbox(d, (cx - 320, ys, cx + 320, ys + 80), "全体投票：候选人同样有投票权", size=21)
ys += 150
diamond(d, (cx - 210, ys, cx + 210, ys + 140), "最高票并列？", 20)
d.text((cx + 230, ys + 55), "否：直接出局", font=f(19), fill=MUTED)
arrow(d, (cx, ys + 140), (cx - 330, ys + 280), label="是", )
arrow(d, (cx + 10, ys + 120), (cx + 330, ys + 260))
ys += 280

rbox(d, (cx - 460, ys, cx - 60, ys + 90), "进入加赛：\n候选人依次补充发言", size=19)
rbox(d, (cx + 60, ys, cx + 470, ys + 90), "票数最高者出局\n（再平票则无人出局）", size=19)
arrow(d, (cx - 260, ys + 90), (cx, ys + 170))
arrow(d, (cx + 260, ys + 90), (cx, ys + 170))
ys += 170

rbox(d, (cx - 380, ys, cx + 380, ys + 90), "判定胜负：卧底出尽→平民胜 / 平民出尽或仅剩\n一平民一卧底→卧底胜", size=19)
ys += 170
diamond(d, (cx - 200, ys, cx + 200, ys + 140), "游戏结束？", 20)
arrow(d, (cx - 200, ys + 70), (cx - 420, ys + 170), label="是")
d.text((cx - 430, ys + 130), "（结束）", font=f(19), fill=INK)
arrow(d, (cx + 200, ys + 70), (cx + 430, ys + 170), label="否")
d.text((cx + 360, ys + 130), "进入下一轮", font=f(19), fill=INK)
img.save(OUT + r"\03-卧底投票活动图.png")
print("done")
