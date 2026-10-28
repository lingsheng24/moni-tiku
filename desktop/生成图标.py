# -*- coding: utf-8 -*-
"""
智能题库生成器 · 正式图标生成
纯 Pillow 绘制：蓝紫渐变圆角底 + 白色翻开的书 + 绿色对勾徽章 + AI 星芒
输出：icons/icon.ico（256/128/64/48/32/16 多尺寸）、icon_1024.png、icon_512.png
用法：python 生成图标.py
"""
import os
import math
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
os.makedirs(OUT, exist_ok=True)

SIZE = 1024          # 最终画布
SS = 4               # 超采样倍数（先画 4 倍再缩，边缘干净）
N = SIZE * SS
U = N / 1000.0       # 设计单位：1000 x 1000

C1 = (79, 110, 247)   # #4f6ef7 主题蓝
C2 = (139, 92, 246)   # #8b5cf6 主题紫
WHITE = (255, 255, 255, 255)
GREEN = (34, 197, 94, 255)
GOLD = (253, 224, 71, 255)
LINE = (199, 210, 254, 255)   # 书页上的文字线
SPINE = (59, 91, 219, 255)


def gradient(size, c1, c2):
    """对角线渐变（小图生成后放大，速度快且平滑）"""
    g = Image.new('RGB', (256, 256))
    px = g.load()
    for y in range(256):
        for x in range(256):
            t = (x + y) / (2 * 255.0)
            px[x, y] = (
                int(c1[0] + (c2[0] - c1[0]) * t),
                int(c1[1] + (c2[1] - c1[1]) * t),
                int(c1[2] + (c2[2] - c1[2]) * t),
            )
    return g.resize((size, size), Image.BICUBIC)


def rounded_mask(size, radius_ratio=0.22):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    return m


def star(d, cx, cy, r, fill):
    """四角星芒"""
    pts = []
    for i in range(8):
        a = math.pi / 4 * i - math.pi / 2
        rr = r if i % 2 == 0 else r * 0.34
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    d.polygon(pts, fill=fill)


def main():
    grad = gradient(N, C1, C2)
    canvas = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    canvas.paste(grad, (0, 0), rounded_mask(N))
    d = ImageDraw.Draw(canvas)

    # ---------- 翻开的书 ----------
    d.polygon([
        (500 * U, 352 * U), (196 * U, 392 * U), (196 * U, 452 * U),
        (238 * U, 660 * U), (500 * U, 700 * U),
    ], fill=WHITE)
    d.polygon([
        (500 * U, 352 * U), (804 * U, 392 * U), (804 * U, 452 * U),
        (762 * U, 660 * U), (500 * U, 700 * U),
    ], fill=WHITE)
    # 书脊
    d.rounded_rectangle([486 * U, 344 * U, 514 * U, 706 * U],
                        radius=14 * U, fill=SPINE)
    # 书页上的文字线
    for y in (452, 522, 592):
        d.rounded_rectangle([268 * U, y * U, 452 * U, (y + 13) * U],
                            radius=6 * U, fill=LINE)
        d.rounded_rectangle([548 * U, y * U, 732 * U, (y + 13) * U],
                            radius=6 * U, fill=LINE)

    # ---------- AI 星芒 ----------
    star(d, 268 * U, 262 * U, 62 * U, GOLD)
    star(d, 742 * U, 226 * U, 40 * U, GOLD)
    star(d, 806 * U, 330 * U, 26 * U, WHITE)

    # ---------- 右下角对勾徽章 ----------
    bx, by, br = 738 * U, 742 * U, 152 * U
    d.ellipse([bx - br - 26 * U, by - br - 26 * U, bx + br + 26 * U, by + br + 26 * U],
              fill=WHITE)
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=GREEN)
    d.line([(bx - 66 * U, by + 4 * U), (bx - 14 * U, by + 58 * U), (bx + 74 * U, by - 62 * U)],
           fill=WHITE, width=max(2, int(34 * U)), joint='curve')

    # ---------- 降采样输出 ----------
    final = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    png1024 = os.path.join(OUT, 'icon_1024.png')
    final.save(png1024)
    final.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon_512.png'))

    sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    ico = os.path.join(OUT, 'icon.ico')
    final.save(ico, format='ICO', sizes=sizes)

    print('图标已生成：')
    for f in (png1024, os.path.join(OUT, 'icon_512.png'), ico):
        print('  %s  (%.1f KB)' % (f, os.path.getsize(f) / 1024))
    return ico


if __name__ == '__main__':
    main()
