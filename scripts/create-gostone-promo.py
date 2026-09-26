"""Render a 30-second vertical GoStone social promo.

The animation is intentionally self-contained: artwork is drawn procedurally,
and the audio bed is generated from synthesis rather than copied music.

Run with Pillow, NumPy and an ffmpeg binary available.  In the Codex workspace
we use imageio-ffmpeg only to locate its bundled ffmpeg executable.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


WIDTH = 720
HEIGHT = 1280
FPS = 24
DURATION = 30.0
BOARD_PX = 900
BOARD_MARGIN = 72
GRID_STEP = (BOARD_PX - 2 * BOARD_MARGIN) / 8
BG_YY, BG_XX = np.mgrid[0:HEIGHT, 0:WIDTH]

INK = (10, 11, 13)
IVORY = (244, 242, 232)
CREAM = (228, 222, 204)
RED = (242, 65, 80)
MAGENTA = (221, 55, 180)
CYAN = (84, 227, 226)
GOLD = (239, 189, 91)

ROOT = Path(__file__).resolve().parents[1]
FONT_REGULAR = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "bahnschrift.ttf"
FONT_BOLD = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "segoeuib.ttf"


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def smoothstep(a: float, b: float, x: float) -> float:
    if a == b:
        return 1.0 if x >= b else 0.0
    p = clamp((x - a) / (b - a))
    return p * p * (3.0 - 2.0 * p)


def ease_out_back(x: float) -> float:
    x = clamp(x)
    c1 = 1.70158
    c3 = c1 + 1.0
    return 1.0 + c3 * (x - 1.0) ** 3 + c1 * (x - 1.0) ** 2


def pulse(t: float, center: float, width: float) -> float:
    return math.exp(-((t - center) / width) ** 2)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if bold and FONT_BOLD.exists() else FONT_REGULAR
    return ImageFont.truetype(str(path), size)


def text_centered(
    image: Image.Image,
    text: str,
    y: int,
    size: int,
    fill: tuple[int, int, int, int],
    *,
    bold: bool = False,
    tracking: int = 0,
    glow: tuple[int, int, int] | None = None,
    glow_radius: int = 18,
) -> None:
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    fnt = font(size, bold)
    if tracking:
        widths = [draw.textlength(char, font=fnt) for char in text]
        total = sum(widths) + tracking * max(0, len(text) - 1)
        x = (image.width - total) / 2
        for char, width in zip(text, widths):
            draw.text((x, y), char, font=fnt, fill=fill, anchor="la")
            x += width + tracking
    else:
        draw.text((image.width / 2, y), text, font=fnt, fill=fill, anchor="ma")
    if glow:
        alpha = layer.getchannel("A")
        blurred = alpha.filter(ImageFilter.GaussianBlur(glow_radius))
        color = Image.new("RGBA", image.size, (*glow, 0))
        color.putalpha(blurred.point(lambda value: min(180, value)))
        image.alpha_composite(color)
    image.alpha_composite(layer)


def radial_background(t: float) -> Image.Image:
    yy, xx = BG_YY, BG_XX
    base = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
    base[:] = (7, 8, 11)

    # Red energy gathers around the capture; cool cyan balances the opposite side.
    capture = pulse(t, 14.1, 3.5)
    red_x = WIDTH * (0.45 + 0.06 * math.sin(t * 0.5))
    red_y = HEIGHT * (0.50 + 0.03 * math.cos(t * 0.4))
    red_r = np.exp(-(((xx - red_x) / 470) ** 2 + ((yy - red_y) / 660) ** 2))
    cyan_r = np.exp(-(((xx - WIDTH * 0.92) / 430) ** 2 + ((yy - HEIGHT * 0.16) / 460) ** 2))
    base[:, :, 0] += red_r * (10 + 39 * capture)
    base[:, :, 1] += red_r * (2 + 4 * capture)
    base[:, :, 2] += red_r * (8 + 20 * capture)
    base[:, :, 0] += cyan_r * 2
    base[:, :, 1] += cyan_r * 11
    base[:, :, 2] += cyan_r * 14

    vignette = 1.0 - 0.62 * np.clip(((xx - WIDTH / 2) / (WIDTH * 0.72)) ** 2 + ((yy - HEIGHT / 2) / (HEIGHT * 0.68)) ** 2, 0, 1)
    base *= vignette[:, :, None]
    base = np.clip(base, 0, 255).astype(np.uint8)
    return Image.fromarray(base, "RGB").convert("RGBA")


def add_smoke(image: Image.Image, t: float) -> None:
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for i in range(14):
        phase = i * 1.731
        x = WIDTH * (0.08 + 0.84 * ((i * 0.317 + t * 0.009) % 1.0))
        y = HEIGHT * (0.18 + 0.70 * ((i * 0.199 + t * 0.012) % 1.0))
        radius = 100 + 55 * math.sin(t * 0.23 + phase)
        alpha = 9 + int(7 * (0.5 + 0.5 * math.sin(t * 0.6 + phase)))
        tone = RED if i % 3 == 0 else CYAN if i % 5 == 0 else (150, 150, 160)
        draw.ellipse((x - radius, y - radius * 0.55, x + radius, y + radius * 0.55), fill=(*tone, alpha))
    image.alpha_composite(layer.filter(ImageFilter.GaussianBlur(58)))


def make_stone(size: int, color: str) -> Image.Image:
    scale = 2
    s = size * scale
    yy, xx = np.mgrid[0:s, 0:s]
    cx = cy = (s - 1) / 2
    nx = (xx - cx) / (s / 2)
    ny = (yy - cy) / (s / 2)
    r2 = nx * nx + ny * ny
    mask = r2 <= 1.0
    z = np.sqrt(np.clip(1.0 - r2, 0.0, 1.0))
    lx, ly, lz = -0.42, -0.58, 0.70
    dot = np.clip(nx * lx + ny * ly + z * lz, 0.0, 1.0)
    rim = np.clip((r2 - 0.56) / 0.44, 0.0, 1.0)
    if color == "black":
        value = 18 + 50 * dot + 16 * z - 8 * rim
        rgb = np.dstack((value * 0.88, value * 0.94, value))
    else:
        value = 178 + 66 * dot + 18 * z - 14 * rim
        rgb = np.dstack((value * 1.02, value, value * 0.94))
    alpha = np.where(mask, np.clip((1.04 - np.sqrt(r2)) * 1200, 0, 255), 0)
    rgba = np.dstack((np.clip(rgb, 0, 255), alpha)).astype(np.uint8)
    stone = Image.fromarray(rgba, "RGBA")
    shine = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shine)
    sd.ellipse((s * 0.20, s * 0.14, s * 0.43, s * 0.31), fill=(255, 255, 255, 42 if color == "black" else 72))
    stone.alpha_composite(shine.filter(ImageFilter.GaussianBlur(s * 0.035)))
    return stone.resize((size, size), Image.Resampling.LANCZOS)


STONE_BLACK = make_stone(88, "black")
STONE_WHITE = make_stone(88, "white")


def make_stone_shadow(size: int = 108) -> Image.Image:
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    draw.ellipse((10, 17, size - 3, size - 5), fill=(0, 0, 0, 118))
    return shadow.filter(ImageFilter.GaussianBlur(9))


STONE_SHADOW = make_stone_shadow()


BLACK_STONES = {
    (0, 1), (1, 5), (2, 2), (2, 4), (3, 2), (4, 2), (5, 3),
    (5, 4), (4, 5), (3, 5), (2, 4), (6, 1), (6, 6), (7, 3),
    (8, 7), (1, 7), (7, 8), (5, 7),
}
WHITE_STONES = {
    (1, 2), (1, 4), (3, 3), (4, 3), (3, 4), (4, 4), (6, 2),
    (7, 5), (5, 6), (2, 7), (7, 1), (8, 4), (4, 7),
}
CAPTURE_GROUP = {(3, 3), (4, 3), (3, 4), (4, 4)}
CAPTURE_MOVE = (2, 3)


def grid_xy(coord: tuple[int, int]) -> tuple[float, float]:
    x, y = coord
    return BOARD_MARGIN + x * GRID_STEP, BOARD_MARGIN + y * GRID_STEP


def board_camera(t: float) -> tuple[float, float, float, float]:
    # scale, rotation, x, y. Cuts echo the punchy reference without copying it.
    if t < 2.5:
        p = smoothstep(0.0, 2.5, t)
        return 0.78 + 0.22 * p, -7.0 + 4.0 * p, WIDTH * 0.53, HEIGHT * (0.61 - 0.03 * p)
    if t < 6.0:
        p = smoothstep(2.5, 6.0, t)
        return 1.05 + 0.18 * p, -3.0 + 2.0 * p, WIDTH * (0.51 - 0.05 * p), HEIGHT * 0.58
    if t < 9.5:
        p = smoothstep(6.0, 9.5, t)
        return 1.34 - 0.06 * p, 2.2 - 4.2 * p, WIDTH * (0.55 + 0.04 * p), HEIGHT * (0.60 + 0.02 * p)
    if t < 13.5:
        p = smoothstep(9.5, 13.5, t)
        return 1.25 + 0.20 * p, -2.0 + 1.0 * p, WIDTH * (0.58 - 0.06 * p), HEIGHT * 0.62
    if t < 17.5:
        shake = pulse(t, 14.05, 0.28) * math.sin(t * 95) * 7
        p = smoothstep(13.5, 17.5, t)
        return 1.43 - 0.09 * p, -1.0 + 3.0 * p, WIDTH * 0.52 + shake, HEIGHT * 0.61 - shake * 0.5
    if t < 22.5:
        p = smoothstep(17.5, 22.5, t)
        return 1.30 - 0.18 * p, 2.0 - 7.0 * p, WIDTH * (0.49 + 0.04 * p), HEIGHT * (0.60 - 0.03 * p)
    if t < 26.2:
        p = smoothstep(22.5, 26.2, t)
        return 1.08 - 0.25 * p, -5.0 + 5.0 * p, WIDTH * 0.50, HEIGHT * (0.58 - 0.02 * p)
    return 0.82, 0.0, WIDTH * 0.5, HEIGHT * 0.55


def draw_stone(
    board: Image.Image,
    coord: tuple[int, int],
    color: str,
    *,
    opacity: float = 1.0,
    scale: float = 1.0,
    offset_y: float = 0.0,
    glow: tuple[int, int, int] | None = None,
    glow_strength: float = 0.0,
) -> None:
    x, y = grid_xy(coord)
    size = max(4, int(88 * scale))
    original = STONE_BLACK if color == "black" else STONE_WHITE
    sprite = original.copy() if size == 88 else original.resize((size, size), Image.Resampling.LANCZOS)
    if opacity < 1:
        sprite.putalpha(sprite.getchannel("A").point(lambda value: int(value * opacity)))
    px = int(x - size / 2)
    py = int(y - size / 2 + offset_y)
    shadow_size = max(6, int(STONE_SHADOW.width * scale))
    shadow = STONE_SHADOW if shadow_size == STONE_SHADOW.width else STONE_SHADOW.resize((shadow_size, shadow_size), Image.Resampling.BILINEAR)
    if opacity < 1:
        shadow = shadow.copy()
        shadow.putalpha(shadow.getchannel("A").point(lambda value: int(value * opacity)))
    board.alpha_composite(shadow, (int(x - shadow_size / 2 + 5), int(y - shadow_size / 2 + offset_y + 9)))
    if glow and glow_strength > 0:
        gl = Image.new("RGBA", board.size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(gl)
        radius = size * (0.65 + glow_strength * 0.22)
        gd.ellipse((x - radius, y + offset_y - radius, x + radius, y + offset_y + radius), fill=(*glow, int(75 * glow_strength * opacity)))
        board.alpha_composite(gl.filter(ImageFilter.GaussianBlur(int(18 + 14 * glow_strength))))
    board.alpha_composite(sprite, (px, py))


def render_board(t: float) -> Image.Image:
    board = Image.new("RGBA", (BOARD_PX, BOARD_PX), (0, 0, 0, 0))
    wood = Image.new("RGBA", board.size, (50, 39, 34, 255))
    wd = ImageDraw.Draw(wood)
    # Dark lacquered wood grain, close to the reference but recognisably a Go board.
    for y in range(0, BOARD_PX, 4):
        tone = int(4 * math.sin(y * 0.047) + 3 * math.sin(y * 0.013 + 1.5))
        wd.line((0, y, BOARD_PX, y), fill=(58 + tone, 43 + tone, 36 + tone, 255), width=2)
    for i in range(34):
        y = (i * 67 + 29) % BOARD_PX
        wd.arc((-100, y - 35, BOARD_PX + 100, y + 80), 190, 350, fill=(82, 56, 42, 28), width=2)
    wood = wood.filter(ImageFilter.GaussianBlur(0.35))
    board.alpha_composite(wood)
    draw = ImageDraw.Draw(board)
    for i in range(9):
        pos = BOARD_MARGIN + i * GRID_STEP
        draw.line((BOARD_MARGIN, pos, BOARD_PX - BOARD_MARGIN, pos), fill=(17, 14, 13, 210), width=3)
        draw.line((pos, BOARD_MARGIN, pos, BOARD_PX - BOARD_MARGIN), fill=(17, 14, 13, 210), width=3)
    for sx, sy in ((2, 2), (6, 2), (4, 4), (2, 6), (6, 6)):
        x, y = grid_xy((sx, sy))
        draw.ellipse((x - 7, y - 7, x + 7, y + 7), fill=(13, 12, 11, 240))

    group_warning = smoothstep(10.2, 12.0, t) * (1.0 - smoothstep(14.3, 16.3, t))
    for coord in sorted(BLACK_STONES):
        draw_stone(board, coord, "black", glow=CYAN, glow_strength=0.18 if 6.0 < t < 10.0 else 0.0)
    for coord in sorted(WHITE_STONES):
        if coord in CAPTURE_GROUP and t >= 14.25:
            p = smoothstep(14.25, 15.9, t)
            # Each captured stone lifts and evaporates at a slightly different pace.
            delay = (coord[0] + coord[1] * 2) * 0.045
            q = smoothstep(14.25 + delay, 15.75 + delay, t)
            draw_stone(
                board,
                coord,
                "white",
                opacity=1.0 - q,
                scale=1.0 - 0.48 * q,
                offset_y=-92 * q,
                glow=RED,
                glow_strength=1.4 * (1.0 - q),
            )
        else:
            draw_stone(board, coord, "white", glow=RED, glow_strength=group_warning if coord in CAPTURE_GROUP else 0.0)

    # Last liberty marker and the decisive black placement.
    mx, my = grid_xy(CAPTURE_MOVE)
    if 10.8 < t < 13.72:
        marker = smoothstep(10.8, 11.5, t) * (1.0 - smoothstep(13.1, 13.72, t))
        radius = 24 + 15 * (0.5 + 0.5 * math.sin(t * 7))
        draw.ellipse((mx - radius, my - radius, mx + radius, my + radius), outline=(*RED, int(220 * marker)), width=6)
        draw.ellipse((mx - 8, my - 8, mx + 8, my + 8), fill=(*RED, int(210 * marker)))
    if t >= 13.72:
        p = smoothstep(13.72, 14.12, t)
        landing = ease_out_back(p)
        offset = -220 * (1.0 - p)
        scale = 0.72 + 0.28 * landing
        draw_stone(board, CAPTURE_MOVE, "black", scale=scale, offset_y=offset, glow=RED, glow_strength=1.2 * pulse(t, 14.08, 0.55))
        ring_alpha = int(220 * pulse(t, 14.12, 0.38))
        ring_radius = 42 + 115 * smoothstep(14.0, 14.65, t)
        draw.ellipse((mx - ring_radius, my - ring_radius, mx + ring_radius, my + ring_radius), outline=(*GOLD, ring_alpha), width=7)

    # Capture sparks live on the board so they inherit the camera motion.
    if 13.8 < t < 16.8:
        rng = random.Random(711)
        spark = Image.new("RGBA", board.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(spark)
        life = smoothstep(13.8, 14.2, t) * (1.0 - smoothstep(15.8, 16.8, t))
        cx = sum(grid_xy(c)[0] for c in CAPTURE_GROUP) / 4
        cy = sum(grid_xy(c)[1] for c in CAPTURE_GROUP) / 4
        for i in range(72):
            angle = rng.random() * math.tau
            speed = 45 + rng.random() * 190
            age = max(0.0, t - 14.1) * (0.6 + rng.random() * 0.8)
            x = cx + math.cos(angle) * speed * age
            y = cy + math.sin(angle) * speed * age - age * 32
            r = 2 + rng.random() * 4
            color = GOLD if i % 4 == 0 else RED
            sd.ellipse((x - r, y - r, x + r, y + r), fill=(*color, int(210 * life)))
        board.alpha_composite(spark.filter(ImageFilter.GaussianBlur(1.2)))

    # Edge vignette gives the board a cinematic falloff.
    vignette = Image.new("L", board.size, 0)
    vd = ImageDraw.Draw(vignette)
    vd.ellipse((-90, -90, BOARD_PX + 90, BOARD_PX + 90), fill=255)
    vignette = vignette.filter(ImageFilter.GaussianBlur(95))
    board.putalpha(ImageChops.multiply(board.getchannel("A"), vignette))
    return board


def composite_board(frame: Image.Image, board: Image.Image, t: float) -> None:
    scale, angle, cx, cy = board_camera(t)
    display_size = max(40, int(BOARD_PX * scale))
    resized = board.resize((display_size, display_size), Image.Resampling.LANCZOS)
    rotated = resized.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    shadow = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    shadow_mask = rotated.getchannel("A").filter(ImageFilter.GaussianBlur(36))
    shadow_color = Image.new("RGBA", rotated.size, (0, 0, 0, 150))
    shadow_color.putalpha(shadow_mask.point(lambda value: int(value * 0.60)))
    pos = (int(cx - rotated.width / 2), int(cy - rotated.height / 2))
    shadow.alpha_composite(shadow_color, (pos[0] + 10, pos[1] + 34))
    frame.alpha_composite(shadow)
    frame.alpha_composite(rotated, pos)


def add_light_streaks(frame: Image.Image, t: float) -> None:
    intensity = max(pulse(t, 6.15, 0.25), pulse(t, 9.55, 0.25), pulse(t, 17.55, 0.28), pulse(t, 22.55, 0.28))
    if intensity < 0.01:
        return
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x = int((smoothstep(0.0, 1.0, (t * 2.7) % 1.0) * 1.5 - 0.25) * WIDTH)
    draw.polygon(((x - 150, 0), (x + 30, 0), (x + 220, HEIGHT), (x + 40, HEIGHT)), fill=(255, 255, 255, int(95 * intensity)))
    frame.alpha_composite(layer.filter(ImageFilter.GaussianBlur(42)))


def add_titles(frame: Image.Image, t: float) -> None:
    if 0.55 < t < 2.7:
        alpha = int(255 * smoothstep(0.55, 1.05, t) * (1.0 - smoothstep(2.15, 2.7, t)))
        text_centered(frame, "EIN ZUG.", 170, 62, (*IVORY, alpha), bold=True, tracking=9, glow=RED, glow_radius=22)
        text_centered(frame, "ALLES ÄNDERT SICH.", 246, 24, (*CREAM, int(alpha * 0.78)), tracking=6)
    if 9.4 < t < 12.9:
        alpha = int(255 * smoothstep(9.4, 10.1, t) * (1.0 - smoothstep(12.2, 12.9, t)))
        text_centered(frame, "NUR EINE FREIHEIT.", 153, 36, (*IVORY, alpha), bold=True, tracking=5, glow=RED)
        text_centered(frame, "ATARI", 207, 22, (*RED, alpha), bold=True, tracking=10)
    if 15.0 < t < 18.6:
        alpha = int(255 * smoothstep(15.0, 15.7, t) * (1.0 - smoothstep(17.9, 18.6, t)))
        text_centered(frame, "GESCHLAGEN.", 950, 50, (*IVORY, alpha), bold=True, tracking=7, glow=RED)
        text_centered(frame, "VIER STEINE VOM BRETT.", 1017, 22, (*CREAM, int(alpha * 0.82)), tracking=4)
    if 20.0 < t < 24.5:
        alpha = int(255 * smoothstep(20.0, 20.7, t) * (1.0 - smoothstep(23.7, 24.5, t)))
        text_centered(frame, "DENKE TIEFER.", 158, 45, (*IVORY, alpha), bold=True, tracking=6, glow=CYAN)
        text_centered(frame, "SPIELE GO.", 218, 24, (*CYAN, alpha), bold=True, tracking=7)
    if 24.0 < t < 26.55:
        alpha = int(255 * smoothstep(24.0, 24.5, t) * (1.0 - smoothstep(26.05, 26.55, t)))
        text_centered(frame, "SPIELEN  ·  LERNEN  ·  MEISTERN", 1008, 23, (*IVORY, alpha), bold=True, tracking=3)


def logo_mark(size: int = 116) -> Image.Image:
    mark = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(mark)
    r = size * 0.28
    bx, by = size * 0.43, size * 0.43
    wx, wy = size * 0.60, size * 0.60
    draw.ellipse((bx - r + 7, by - r + 10, bx + r + 7, by + r + 10), fill=(0, 0, 0, 55))
    black = make_stone(int(r * 2), "black")
    white = make_stone(int(r * 2), "white")
    mark.alpha_composite(white, (int(wx - r), int(wy - r)))
    mark.alpha_composite(black, (int(bx - r), int(by - r)))
    return mark


LOGO = logo_mark()


def end_card(frame: Image.Image, t: float) -> Image.Image:
    p = smoothstep(26.15, 27.15, t)
    cream = Image.new("RGBA", frame.size, (*IVORY, int(255 * p)))
    frame = Image.alpha_composite(frame, cream)
    if p < 0.04:
        return frame
    mark_scale = 0.70 + 0.30 * ease_out_back(smoothstep(26.55, 27.45, t))
    mark = LOGO.resize((int(LOGO.width * mark_scale), int(LOGO.height * mark_scale)), Image.Resampling.LANCZOS)
    mark.putalpha(mark.getchannel("A").point(lambda value: int(value * p)))
    frame.alpha_composite(mark, (int(WIDTH / 2 - mark.width / 2), int(HEIGHT * 0.29 - mark.height / 2)))
    alpha = int(255 * smoothstep(26.75, 27.55, t))
    text_centered(frame, "GoStone", 507, 67, (*INK, alpha), bold=True, tracking=1)
    text_centered(frame, "PLAY · LEARN · MASTER GO", 605, 20, (43, 43, 43, int(alpha * 0.72)), bold=True, tracking=6)
    # URL is the final and strongest visual anchor.
    url_alpha = int(255 * smoothstep(27.25, 28.15, t))
    text_centered(frame, "gostone.app", 760, 48, (*INK, url_alpha), bold=True, tracking=3)
    underline = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    ud = ImageDraw.Draw(underline)
    line_p = smoothstep(27.75, 28.65, t)
    line_w = int(282 * line_p)
    ud.rounded_rectangle((WIDTH / 2 - line_w / 2, 830, WIDTH / 2 + line_w / 2, 837), radius=4, fill=(*RED, url_alpha))
    frame.alpha_composite(underline)
    text_centered(frame, "DEINE NÄCHSTE PARTIE BEGINNT HIER.", 901, 20, (50, 50, 50, int(url_alpha * 0.72)), tracking=3)
    return frame


def add_grain(frame: Image.Image, frame_index: int) -> None:
    rng = np.random.default_rng(9000 + frame_index % 11)
    noise = rng.normal(128, 24, (HEIGHT // 4, WIDTH // 4)).clip(0, 255).astype(np.uint8)
    noise_img = Image.fromarray(noise, "L").resize((WIDTH, HEIGHT), Image.Resampling.BILINEAR)
    noise_rgba = Image.merge("RGBA", (noise_img, noise_img, noise_img, Image.new("L", frame.size, 13)))
    frame.alpha_composite(noise_rgba)


def render_frame(frame_index: int) -> Image.Image:
    t = frame_index / FPS
    frame = radial_background(t)
    add_smoke(frame, t)
    if t < 26.9:
        board = render_board(t)
        composite_board(frame, board, t)
        add_light_streaks(frame, t)
        add_titles(frame, t)
    if t >= 26.0:
        frame = end_card(frame, t)
    add_grain(frame, frame_index)
    return frame.convert("RGB")


def synth_audio(output: Path) -> None:
    sample_rate = 48_000
    total = int(DURATION * sample_rate)
    t = np.arange(total, dtype=np.float64) / sample_rate
    audio = np.zeros(total, dtype=np.float64)

    # Dark tonal bed: quiet enough for platform voice-over, strong enough on its own.
    drone = 0.045 * np.sin(2 * np.pi * 43.65 * t) + 0.024 * np.sin(2 * np.pi * 87.3 * t + 0.4)
    drone *= 0.72 + 0.28 * np.sin(2 * np.pi * 0.09 * t) ** 2
    audio += drone
    rng = np.random.default_rng(1947)
    noise = rng.normal(0.0, 1.0, total)
    # Cheap low-pass for atmospheric texture.
    low_noise = np.convolve(noise, np.ones(280) / 280, mode="same")
    audio += 0.025 * low_noise

    def add_hit(time_s: float, gain: float = 1.0, bright: bool = False) -> None:
        start = int(time_s * sample_rate)
        length = int((0.9 if bright else 1.3) * sample_rate)
        local_t = np.arange(length) / sample_rate
        freq = 145.0 if bright else 58.0
        hit = np.sin(2 * np.pi * freq * local_t) * np.exp(-local_t * (10 if bright else 5.6))
        hit += 0.35 * np.sin(2 * np.pi * freq * 2.02 * local_t) * np.exp(-local_t * 9)
        crack = rng.normal(0, 1, length) * np.exp(-local_t * 34)
        hit = (0.18 * hit + 0.07 * crack) * gain
        end = min(total, start + length)
        audio[start:end] += hit[: end - start]

    def add_whoosh(time_s: float, length_s: float = 0.55, gain: float = 1.0) -> None:
        start = int(time_s * sample_rate)
        length = int(length_s * sample_rate)
        local_t = np.arange(length) / sample_rate
        env = np.sin(np.pi * np.clip(local_t / length_s, 0, 1)) ** 2
        raw = rng.normal(0, 1, length)
        # A differentiated noise signal has a crisp, airy character.
        airy = np.concatenate(([0.0], np.diff(raw)))
        whoosh = 0.022 * airy * env * gain
        end = min(total, start + length)
        audio[start:end] += whoosh[: end - start]

    for cut in (2.48, 5.98, 9.48, 17.48, 22.48, 26.12):
        add_whoosh(cut - 0.22, 0.52, 1.15)
        add_hit(cut, 0.55, bright=True)
    add_hit(13.92, 0.85, bright=True)
    add_hit(14.10, 2.15, bright=False)
    for time_s in (14.46, 14.71, 14.96, 15.21):
        add_hit(time_s, 0.55, bright=True)
    add_hit(27.28, 0.48, bright=True)

    fade_in = np.clip(t / 0.6, 0, 1)
    fade_out = np.clip((DURATION - t) / 0.75, 0, 1)
    audio *= fade_in * fade_out
    peak = max(1e-9, np.max(np.abs(audio)))
    audio = np.tanh(audio / max(0.55, peak) * 1.25) * 0.72
    pcm = np.int16(np.clip(audio, -1, 1) * 32767)
    stereo = np.column_stack((pcm, pcm)).ravel()
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(stereo.tobytes())


def find_ffmpeg(explicit: str | None) -> str:
    if explicit:
        return explicit
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - friendly local-run failure
        raise SystemExit("Pass --ffmpeg or install imageio-ffmpeg.") from exc


def render_video(output: Path, ffmpeg: str, preview: bool = False) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    frame_count = int((6.0 if preview else DURATION) * FPS)
    with tempfile.TemporaryDirectory(prefix="gostone-promo-") as temp_dir:
        temp = Path(temp_dir)
        silent = temp / "silent.mp4"
        audio = temp / "soundtrack.wav"
        command = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-s",
            f"{WIDTH}x{HEIGHT}",
            "-r",
            str(FPS),
            "-i",
            "-",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "17",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(silent),
        ]
        process = subprocess.Popen(command, stdin=subprocess.PIPE)
        assert process.stdin is not None
        for index in range(frame_count):
            process.stdin.write(np.asarray(render_frame(index), dtype=np.uint8).tobytes())
            if index % FPS == 0:
                print(f"Rendered {index // FPS:02d}s / {frame_count // FPS:02d}s", flush=True)
        process.stdin.close()
        if process.wait() != 0:
            raise SystemExit("ffmpeg failed while encoding the animation")
        if preview:
            silent.replace(output)
            return
        synth_audio(audio)
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(silent),
                "-i",
                str(audio),
                "-vf",
                "scale=1080:1920:flags=lanczos",
                "-c:v",
                "libx264",
                "-preset",
                "slow",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-shortest",
                "-movflags",
                "+faststart",
                str(output),
            ],
            check=True,
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "gostone-promo-30s.mp4")
    parser.add_argument("--ffmpeg", type=str)
    parser.add_argument("--preview", action="store_true", help="Render only the first six seconds, without audio")
    args = parser.parse_args()
    render_video(args.output, find_ffmpeg(args.ffmpeg), args.preview)
    print(f"Created {args.output}")


if __name__ == "__main__":
    main()
