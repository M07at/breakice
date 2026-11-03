#!/usr/bin/env python3
"""把 art/ 里的原始美术素材压缩成小程序可直接引用的静态资源。

为什么需要这一步：原图共 4.38 MB，而微信小程序主包上限是 2 MB。
这个脚本只做三件事——裁掉透明边、缩放到显示尺寸、调色板量化，
视觉上看不出差别（按钮图在 800px 宽、160 色下与原始 PNG 几乎一致）。

用法（需要 Python 3 + Pillow）：
    python scripts/optimize-art.py

输出：
    app/src/static/avatar/{color,body,mouth,eyes,hat}/<layer><n>.png
    app/src/static/avatar/main.png
    app/src/static/start/{create-room,join-room,arrow-left,arrow-right}.png

生成结果已经提交到仓库，正常开发不需要重跑；只有替换 art/ 素材后才需要。
"""

from __future__ import annotations

import glob
import os
import re

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_AVATAR = os.path.join(ROOT, "art", "start", "avatar")
SRC_BOTTOM = os.path.join(ROOT, "art", "start", "bottom")
DST_AVATAR = os.path.join(ROOT, "app", "src", "static", "avatar")
DST_START = os.path.join(ROOT, "app", "src", "static", "start")

AVATAR_SIZE = 600
AVATAR_COLORS = 160
BUTTON_WIDTH = 800
BUTTON_COLORS = 160
ARROW_SIZE = 160
ARROW_COLORS = 160

LAYERS = ["color", "body", "mouth", "eyes", "hat"]


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def save_png(image: Image.Image, path: str, colors: int) -> int:
    quantized = image.quantize(colors=colors, method=Image.FASTOCTREE)
    quantized.save(path, format="PNG", optimize=True)
    return os.path.getsize(path)


def trim(image: Image.Image) -> Image.Image:
    box = image.getbbox()
    return image.crop(box) if box else image


def convert_avatar_layers() -> int:
    total = 0
    ensure_dir(DST_AVATAR)
    source_main = os.path.join(SRC_AVATAR, "main.png")
    main = Image.open(source_main).convert("RGBA").resize((AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS)
    total += save_png(main, os.path.join(DST_AVATAR, "main.png"), AVATAR_COLORS)
    for layer in LAYERS:
        target = os.path.join(DST_AVATAR, layer)
        ensure_dir(target)
        files = glob.glob(os.path.join(SRC_AVATAR, layer, "*.png"))
        for source in sorted(files, key=lambda f: int(re.search(r"(\d+)", os.path.basename(f)).group(1))):
            image = Image.open(source).convert("RGBA").resize((AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS)
            total += save_png(image, os.path.join(target, os.path.basename(source)), AVATAR_COLORS)
    return total


def convert_buttons() -> int:
    """两张主按钮裁边后统一成同样尺寸，保证在页面上大小一致。"""
    ensure_dir(DST_START)
    pairs = [("Create Room.png", "create-room.png"), ("Join Room.png", "join-room.png")]
    trimmed = []
    for source_name, _ in pairs:
        image = Image.open(os.path.join(SRC_BOTTOM, source_name)).convert("RGBA")
        trimmed.append(trim(image))
    scaled = [
        image.resize((BUTTON_WIDTH, round(image.size[1] * BUTTON_WIDTH / image.size[0])), Image.LANCZOS)
        for image in trimmed
    ]
    height = max(image.size[1] for image in scaled)
    total = 0
    for (_, target_name), image in zip(pairs, scaled):
        canvas = Image.new("RGBA", (BUTTON_WIDTH, height), (0, 0, 0, 0))
        canvas.alpha_composite(image, (0, (height - image.size[1]) // 2))
        total += save_png(canvas, os.path.join(DST_START, target_name), BUTTON_COLORS)
    return total


def convert_arrows() -> int:
    total = 0
    for source_name, target_name in [("left.png", "arrow-left.png"), ("right.png", "arrow-right.png")]:
        image = trim(Image.open(os.path.join(SRC_BOTTOM, source_name)).convert("RGBA"))
        side = max(image.size)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.alpha_composite(image, ((side - image.size[0]) // 2, (side - image.size[1]) // 2))
        canvas = canvas.resize((ARROW_SIZE, ARROW_SIZE), Image.LANCZOS)
        total += save_png(canvas, os.path.join(DST_START, target_name), ARROW_COLORS)
    return total


def main() -> None:
    avatar_bytes = convert_avatar_layers()
    button_bytes = convert_buttons()
    arrow_bytes = convert_arrows()
    print(f"avatar layers: {avatar_bytes / 1024:.1f} KB")
    print(f"main buttons : {button_bytes / 1024:.1f} KB")
    print(f"arrow buttons: {arrow_bytes / 1024:.1f} KB")
    print(f"total        : {(avatar_bytes + button_bytes + arrow_bytes) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
