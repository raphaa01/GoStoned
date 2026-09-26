"""Render the 30-second GoStone social edit.

The cut follows the visual grammar of the supplied reference: rapid board
shots, clearly highlighted moves, isolated-piece VFX, a second tactical
sequence, and a single text-only brand reveal at the end. All imagery and
sound are generated locally.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


W, H = 720, 1280
FPS = 24
DURATION = 30.0
BOARD_SIZE = 900
MARGIN = 76
STEP = (BOARD_SIZE - 2 * MARGIN) / 8
ROOT = Path(__file__).resolve().parents[1]

INK = (8, 9, 12)
IVORY = (246, 244, 235)
BOARD = (169, 126, 86)
GRID = (34, 25, 20)
RED = (255, 53, 72)
MAGENTA = (238, 56, 206)
VIOLET = (127, 92, 255)
BLUE = (76, 175, 255)
LIME = (153, 255, 74)
GOLD = (255, 205, 92)

FONT_PATH = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "bahnschrift.ttf"
YY, XX = np.mgrid[0:H, 0:W]


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def smooth(a: float, b: float, value: float) -> float:
    if a == b:
        return float(value >= b)
    x = clamp((value - a) / (b - a))
    return x * x * (3 - 2 * x)


def pulse(value: float, center: float, width: float) -> float:
    return math.exp(-((value - center) / width) ** 2)


def ease_back(value: float) -> float:
    x = clamp(value)
    c1 = 1.70158
    c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2


def point(coord: tuple[int, int]) -> tuple[float, float]:
    return MARGIN + coord[0] * STEP, MARGIN + coord[1] * STEP


def make_stone(size: int, color: str) -> Image.Image:
    scale = 3
    side = size * scale
    yy, xx = np.mgrid[0:side, 0:side]
    cx = cy = (side - 1) / 2
    nx, ny = (xx - cx) / (side / 2), (yy - cy) / (side / 2)
    r2 = nx * nx + ny * ny
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    light = np.clip(nx * -0.48 + ny * -0.58 + z * 0.74, 0, 1)
    rim = np.clip((r2 - 0.60) / 0.40, 0, 1)
    if color == "black":
        value = 13 + 55 * light + 21 * z - 9 * rim
        rgb = np.dstack((value * 0.88, value * 0.94, value * 1.04))
    else:
        value = 181 + 67 * light + 18 * z - 15 * rim
        rgb = np.dstack((value * 1.02, value, value * 0.95))
    alpha = np.where(r2 <= 1, np.clip((1.025 - np.sqrt(r2)) * 2800, 0, 255), 0)
    rgba = np.dstack((np.clip(rgb, 0, 255), alpha)).astype(np.uint8)
    result = Image.fromarray(rgba, "RGBA")
    highlight = Image.new("RGBA", result.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(highlight)
    draw.ellipse((side * .20, side * .14, side * .43, side * .30), fill=(255, 255, 255, 53 if color == "black" else 86))
    result.alpha_composite(highlight.filter(ImageFilter.GaussianBlur(side * .035)))
    return result.resize((size, size), Image.Resampling.LANCZOS)


BLACK_STONE = make_stone(90, "black")
WHITE_STONE = make_stone(90, "white")


def make_shadow() -> Image.Image:
    layer = Image.new("RGBA", (116, 116), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse((12, 20, 108, 105), fill=(0, 0, 0, 135))
    return layer.filter(ImageFilter.GaussianBlur(10))


SHADOW = make_shadow()


def make_clean_board() -> Image.Image:
    """A deliberately clean board: one flat surface and exactly nine grid lines."""
    image = Image.new("RGBA", (BOARD_SIZE, BOARD_SIZE), (*BOARD, 255))
    # Gentle illumination, no wood grain or decorative lines.
    yy, xx = np.mgrid[0:BOARD_SIZE, 0:BOARD_SIZE]
    light = 1.0 + 0.10 * np.exp(-(((xx - 260) / 600) ** 2 + ((yy - 190) / 520) ** 2))
    vignette = 1.0 - 0.20 * np.clip(((xx - BOARD_SIZE / 2) / 640) ** 2 + ((yy - BOARD_SIZE / 2) / 640) ** 2, 0, 1)
    arr = np.asarray(image).copy().astype(np.float32)
    arr[:, :, :3] *= (light * vignette)[:, :, None]
    image = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    draw = ImageDraw.Draw(image)
    for index in range(9):
        p = MARGIN + index * STEP
        draw.line((MARGIN, p, BOARD_SIZE - MARGIN, p), fill=(*GRID, 220), width=4)
        draw.line((p, MARGIN, p, BOARD_SIZE - MARGIN), fill=(*GRID, 220), width=4)
    for coord in ((2, 2), (6, 2), (4, 4), (2, 6), (6, 6)):
        x, y = point(coord)
        draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill=(*GRID, 240))
    return image


CLEAN_BOARD = make_clean_board()


POSITION_A_BLACK = {
    (0, 1), (1, 5), (2, 2), (2, 4), (3, 2), (4, 2), (5, 3),
    (5, 4), (3, 5), (6, 1), (6, 6), (7, 3), (8, 7), (1, 7),
    (7, 8), (5, 7),
}
POSITION_A_WHITE = {
    (1, 2), (1, 4), (3, 3), (4, 3), (3, 4), (4, 4), (6, 2),
    (7, 5), (5, 6), (2, 7), (7, 1), (8, 4), (4, 7),
}
CAPTURE_A = {(3, 3), (4, 3), (3, 4), (4, 4)}

POSITION_B_BLACK = {
    (0, 2), (1, 4), (2, 1), (3, 3), (4, 5), (5, 4), (6, 4),
    (7, 5), (7, 6), (6, 7), (4, 8), (8, 1), (3, 7),
}
POSITION_B_WHITE = {
    (1, 1), (2, 3), (3, 5), (5, 5), (6, 5), (6, 6), (7, 2),
    (8, 4), (4, 2), (2, 8),
}
CAPTURE_B = {(5, 5), (6, 5), (6, 6)}


def dark_background(t: float, accent: tuple[int, int, int] = MAGENTA) -> Image.Image:
    base = np.zeros((H, W, 3), dtype=np.float32)
    base[:] = (5, 6, 9)
    cx = W * (0.54 + 0.04 * math.sin(t * 0.35))
    cy = H * 0.51
    radial = np.exp(-(((XX - cx) / 440) ** 2 + ((YY - cy) / 650) ** 2))
    base[:, :, 0] += radial * accent[0] * 0.10
    base[:, :, 1] += radial * accent[1] * 0.10
    base[:, :, 2] += radial * accent[2] * 0.10
    vignette = 1 - 0.70 * np.clip(((XX - W / 2) / (W * .72)) ** 2 + ((YY - H / 2) / (H * .72)) ** 2, 0, 1)
    base *= vignette[:, :, None]
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


def glow_blob(canvas: Image.Image, center: tuple[float, float], radius: float, color: tuple[int, int, int], alpha: int) -> None:
    pad = int(radius * 2.1)
    side = pad * 2
    blob = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ImageDraw.Draw(blob).ellipse((pad - radius, pad - radius, pad + radius, pad + radius), fill=(*color, alpha))
    blob = blob.filter(ImageFilter.GaussianBlur(max(3, int(radius * .42))))
    canvas.alpha_composite(blob, (int(center[0] - pad), int(center[1] - pad)))


def draw_stone(
    board: Image.Image,
    coord: tuple[int, int],
    color: str,
    *,
    scale: float = 1.0,
    opacity: float = 1.0,
    y_offset: float = 0,
    glow: tuple[int, int, int] | None = None,
    glow_power: float = 0,
) -> None:
    x, y = point(coord)
    size = max(5, int(90 * scale))
    shadow_size = max(6, int(116 * scale))
    shadow = SHADOW if shadow_size == 116 else SHADOW.resize((shadow_size, shadow_size), Image.Resampling.BILINEAR)
    if opacity < 1:
        shadow = shadow.copy()
        shadow.putalpha(shadow.getchannel("A").point(lambda a: int(a * opacity)))
    board.alpha_composite(shadow, (int(x - shadow_size / 2 + 5), int(y - shadow_size / 2 + 11 + y_offset)))
    if glow and glow_power > 0:
        glow_blob(board, (x, y + y_offset), 56 + glow_power * 18, glow, int(82 * glow_power * opacity))
    source = BLACK_STONE if color == "black" else WHITE_STONE
    stone = source.copy() if size == 90 else source.resize((size, size), Image.Resampling.LANCZOS)
    if opacity < 1:
        stone.putalpha(stone.getchannel("A").point(lambda a: int(a * opacity)))
    board.alpha_composite(stone, (int(x - size / 2), int(y - size / 2 + y_offset)))


def move_marker(board: Image.Image, coord: tuple[int, int], color: tuple[int, int, int], strength: float, t: float) -> None:
    if strength <= 0:
        return
    x, y = point(coord)
    layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    r = 45 + 9 * math.sin(t * 9)
    draw.rounded_rectangle((x - 52, y - 52, x + 52, y + 52), radius=13, outline=(*color, int(235 * strength)), width=7)
    draw.ellipse((x - r, y - r, x + r, y + r), outline=(*color, int(140 * strength)), width=4)
    glow = layer.filter(ImageFilter.GaussianBlur(18))
    board.alpha_composite(glow)
    board.alpha_composite(layer)


def placement(board: Image.Image, t: float, at: float, color: str, coord: tuple[int, int], accent: tuple[int, int, int]) -> None:
    if t < at:
        marker = smooth(at - .75, at - .12, t) * (1 - smooth(at - .10, at, t))
        move_marker(board, coord, accent, marker, t)
        return
    p = smooth(at, at + .32, t)
    y_offset = -250 * (1 - p)
    scale = .70 + .30 * ease_back(p)
    impact = pulse(t, at + .31, .23)
    draw_stone(board, coord, color, scale=scale, y_offset=y_offset, glow=accent, glow_power=.5 + 1.4 * impact)
    if impact > .03:
        x, y = point(coord)
        layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        radius = 35 + 115 * smooth(at + .18, at + .70, t)
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(*accent, int(220 * impact)), width=8)
        board.alpha_composite(layer)


def capture_particles(board: Image.Image, t: float, at: float, coords: set[tuple[int, int]], accent: tuple[int, int, int]) -> None:
    if not at - .1 < t < at + 1.6:
        return
    rng = random.Random(991 + len(coords))
    layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    life = smooth(at - .1, at + .18, t) * (1 - smooth(at + 1.0, at + 1.6, t))
    centers = [point(coord) for coord in coords]
    cx = sum(p[0] for p in centers) / len(centers)
    cy = sum(p[1] for p in centers) / len(centers)
    age = max(0, t - at)
    for index in range(88):
        angle = rng.random() * math.tau
        speed = 45 + rng.random() * 235
        x = cx + math.cos(angle) * speed * age
        y = cy + math.sin(angle) * speed * age - 65 * age
        r = 2 + rng.random() * 5
        color = GOLD if index % 5 == 0 else accent
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(*color, int(220 * life)))
    board.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1.2)))


def render_board_a(t: float) -> Image.Image:
    board = CLEAN_BOARD.copy()
    for coord in POSITION_A_BLACK:
        draw_stone(board, coord, "black")
    for coord in POSITION_A_WHITE:
        if coord in CAPTURE_A and t >= 5.62:
            q = smooth(5.62 + (coord[0] + coord[1]) * .025, 6.35 + (coord[0] + coord[1]) * .025, t)
            draw_stone(board, coord, "white", scale=1 - .48 * q, opacity=1 - q, y_offset=-115 * q, glow=RED, glow_power=1.4 * (1 - q))
        else:
            warning = smooth(2.1, 2.8, t) * (1 - smooth(5.7, 6.4, t)) if coord in CAPTURE_A else 0
            draw_stone(board, coord, "white", glow=RED, glow_power=warning)
    placement(board, t, 1.95, "black", (2, 3), LIME)
    placement(board, t, 3.55, "white", (7, 7), MAGENTA)
    placement(board, t, 5.18, "black", (4, 5), RED)
    capture_particles(board, t, 5.72, CAPTURE_A, RED)
    return board


MOVES_B = (
    (18.95, "white", (2, 6), BLUE),
    (20.25, "black", (2, 7), LIME),
    (21.55, "white", (1, 7), MAGENTA),
    (22.85, "black", (1, 6), RED),
    (24.15, "white", (8, 2), BLUE),
    (25.45, "black", (5, 6), RED),
)


def render_board_b(t: float) -> Image.Image:
    board = CLEAN_BOARD.copy()
    for coord in POSITION_B_BLACK:
        draw_stone(board, coord, "black")
    for coord in POSITION_B_WHITE:
        if coord in CAPTURE_B and t >= 25.88:
            q = smooth(25.88 + (coord[0] + coord[1]) * .02, 26.55 + (coord[0] + coord[1]) * .02, t)
            draw_stone(board, coord, "white", scale=1 - .50 * q, opacity=1 - q, y_offset=-120 * q, glow=RED, glow_power=1.6 * (1 - q))
        else:
            warning = smooth(24.1, 24.8, t) * (1 - smooth(26.0, 26.6, t)) if coord in CAPTURE_B else 0
            draw_stone(board, coord, "white", glow=RED, glow_power=warning)
    for at, color, coord, accent in MOVES_B:
        placement(board, t, at, color, coord, accent)
    capture_particles(board, t, 25.98, CAPTURE_B, RED)
    return board


def shot_camera(t: float) -> tuple[float, float, float, float]:
    """Hard shot changes with restrained push-ins, never random board wobble."""
    if t < 1.75:
        return .78 + .06 * smooth(0, 1.75, t), -5.0, W * .51, H * .56
    if t < 3.35:
        return 1.30 + .07 * smooth(1.75, 3.35, t), 1.2, W * .66, H * .60
    if t < 4.95:
        return 1.38, -2.4, W * .27, H * .36
    if t < 6.75:
        return 1.52 + .06 * smooth(4.95, 6.75, t), 1.1, W * .42, H * .77
    if t < 8.30:
        return 1.75 + .12 * smooth(6.75, 8.30, t), -1.0, W * .46, H * .74
    if t < 19.0:
        return .84, -4.0, W * .5, H * .56
    if t < 20.25:
        return 1.44, 2.4, W * .70, H * .72
    if t < 21.55:
        return 1.48, -2.0, W * .68, H * .78
    if t < 22.85:
        return 1.53, 1.6, W * .80, H * .82
    if t < 24.15:
        return 1.22, -4.0, W * .60, H * .66
    if t < 25.45:
        return 1.46, 3.0, W * .16, H * .34
    return 1.65 + .12 * smooth(25.45, 27.45, t), -.8, W * .40, H * .65


def composite_board(frame: Image.Image, board: Image.Image, t: float) -> None:
    scale, angle, cx, cy = shot_camera(t)
    side = int(BOARD_SIZE * scale)
    board = board.resize((side, side), Image.Resampling.LANCZOS)
    # Slight camera pitch, kept constant within each shot.
    board = board.resize((side, int(side * .92)), Image.Resampling.LANCZOS)
    board = board.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    position = (int(cx - board.width / 2), int(cy - board.height / 2))
    shadow = board.getchannel("A").filter(ImageFilter.GaussianBlur(38))
    shadow_layer = Image.new("RGBA", board.size, (0, 0, 0, 145))
    shadow_layer.putalpha(shadow.point(lambda a: int(a * .62)))
    frame.alpha_composite(shadow_layer, (position[0] + 8, position[1] + 32))
    frame.alpha_composite(board, position)


def energy_arc(layer: Image.Image, start: tuple[float, float], end: tuple[float, float], seed: int, color: tuple[int, int, int], alpha: int, width: int) -> None:
    rng = random.Random(seed)
    points = []
    for index in range(13):
        p = index / 12
        x = start[0] * (1 - p) + end[0] * p
        y = start[1] * (1 - p) + end[1] * p
        if 0 < index < 12:
            x += rng.uniform(-20, 20)
            y += rng.uniform(-17, 17)
        points.append((x, y))
    ImageDraw.Draw(layer).line(points, fill=(*color, alpha), width=width, joint="curve")


def floating_stone(frame: Image.Image, t: float) -> None:
    local = t - 8.30
    center = (W * .50, H * (.55 - .025 * smooth(0, 8, local)))
    if local < 2.75:
        scale = 2.65 + .22 * math.sin(local * 1.5)
        opacity = smooth(0, .45, local)
        glow_blob(frame, center, 185, VIOLET, int(150 * opacity))
        glow_blob(frame, center, 105, BLUE, int(120 * opacity))
        stone = WHITE_STONE.resize((int(90 * scale), int(90 * scale)), Image.Resampling.LANCZOS)
        stone.putalpha(stone.getchannel("A").point(lambda a: int(a * opacity)))
        frame.alpha_composite(stone, (int(center[0] - stone.width / 2), int(center[1] - stone.height / 2)))
        arcs = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        for index in range(6):
            angle = local * (1.1 + index * .07) + index * math.tau / 6
            start = (center[0] + math.cos(angle) * 125, center[1] + math.sin(angle) * 95)
            end = (center[0] + math.cos(angle + .9) * 210, center[1] + math.sin(angle + .9) * 165)
            energy_arc(arcs, start, end, 2000 + index + int(local * 8), BLUE if index % 2 else VIOLET, 185, 3)
        frame.alpha_composite(arcs.filter(ImageFilter.GaussianBlur(10)))
        frame.alpha_composite(arcs)
    elif local < 4.65:
        p = smooth(2.75, 3.55, local)
        glow_blob(frame, center, 155 + 100 * p, MAGENTA, int(170 * (1 - .5 * p)))
        # The white stone bursts into a black one rather than becoming an unrelated object.
        white_scale = 2.7 * (1 - .72 * p)
        white = WHITE_STONE.resize((int(90 * white_scale), int(90 * white_scale)), Image.Resampling.LANCZOS)
        white.putalpha(white.getchannel("A").point(lambda a: int(a * (1 - p))))
        frame.alpha_composite(white, (int(center[0] - white.width / 2), int(center[1] - white.height / 2)))
        black_scale = .4 + 2.35 * ease_back(p)
        black = BLACK_STONE.resize((int(90 * black_scale), int(90 * black_scale)), Image.Resampling.LANCZOS)
        black.putalpha(black.getchannel("A").point(lambda a: int(a * p)))
        frame.alpha_composite(black, (int(center[0] - black.width / 2), int(center[1] - black.height / 2)))
        particle_cloud(frame, center, local - 2.75, MAGENTA, 95, seed=811)
    elif local < 7.05:
        orbit_t = local - 4.65
        orbit = 118 - 22 * smooth(0, 2.4, orbit_t)
        angle = orbit_t * 2.25
        centers = (
            (center[0] + math.cos(angle) * orbit, center[1] + math.sin(angle) * orbit * .52),
            (center[0] + math.cos(angle + math.pi) * orbit, center[1] + math.sin(angle + math.pi) * orbit * .52),
        )
        for index, (stone_img, pos, accent) in enumerate(((BLACK_STONE, centers[0], RED), (WHITE_STONE, centers[1], BLUE))):
            glow_blob(frame, pos, 105, accent, 110)
            sprite = stone_img.resize((205, 205), Image.Resampling.LANCZOS)
            frame.alpha_composite(sprite, (int(pos[0] - 102), int(pos[1] - 102)))
            trail = Image.new("RGBA", frame.size, (0, 0, 0, 0))
            ImageDraw.Draw(trail).arc((center[0] - orbit - 50, center[1] - orbit * .6 - 30, center[0] + orbit + 50, center[1] + orbit * .6 + 30), int(math.degrees(angle) - 90 + index * 180), int(math.degrees(angle) + 90 + index * 180), fill=(*accent, 165), width=7)
            frame.alpha_composite(trail.filter(ImageFilter.GaussianBlur(12)))
            frame.alpha_composite(trail)
    else:
        p = smooth(7.05, 8.55, local)
        logo_center = (center[0], center[1])
        glow_blob(frame, logo_center, 190 - 35 * p, (175, 185, 255), int(145 * (1 - .35 * p)))
        black = BLACK_STONE.resize((230, 230), Image.Resampling.LANCZOS)
        white = WHITE_STONE.resize((230, 230), Image.Resampling.LANCZOS)
        frame.alpha_composite(white, (int(logo_center[0] - 62), int(logo_center[1] - 50)))
        frame.alpha_composite(black, (int(logo_center[0] - 166), int(logo_center[1] - 154)))
        particle_cloud(frame, logo_center, local - 7.05, (180, 190, 255), 65, seed=1307)


def particle_cloud(frame: Image.Image, center: tuple[float, float], age: float, color: tuple[int, int, int], count: int, seed: int) -> None:
    rng = random.Random(seed)
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for index in range(count):
        angle = rng.random() * math.tau
        base = 35 + rng.random() * 250
        x = center[0] + math.cos(angle) * (base + age * (15 + rng.random() * 35))
        y = center[1] + math.sin(angle) * (base * .75 + age * 18) - age * (5 + rng.random() * 12)
        radius = 1 + rng.random() * 4
        alpha = int(180 * (0.35 + 0.65 * (index % 4 == 0)))
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, alpha))
    frame.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1.5)))


def flash_transition(frame: Image.Image, t: float) -> None:
    amount = max(
        pulse(t, 8.30, .12),
        pulse(t, 11.06, .11),
        pulse(t, 12.95, .10),
        pulse(t, 15.35, .12),
        pulse(t, 17.40, .12),
        pulse(t, 27.65, .15),
    )
    if amount > .01:
        frame.alpha_composite(Image.new("RGBA", frame.size, (245, 247, 255, int(225 * amount))))


def add_film(frame: Image.Image, index: int) -> None:
    # Sparse film grain, not line texture on the board.
    rng = np.random.default_rng(4410 + index % 13)
    noise = rng.normal(128, 20, (H // 5, W // 5)).clip(0, 255).astype(np.uint8)
    noise = Image.fromarray(noise, "L").resize((W, H), Image.Resampling.BILINEAR)
    grain = Image.merge("RGBA", (noise, noise, noise, Image.new("L", (W, H), 9)))
    frame.alpha_composite(grain)
    # Letterbox-like vignette seen in the reference.
    shade = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shade)
    draw.rectangle((0, 0, W, 54), fill=(0, 0, 0, 42))
    draw.rectangle((0, H - 60, W, H), fill=(0, 0, 0, 42))
    frame.alpha_composite(shade)


def end_card(frame: Image.Image, t: float) -> Image.Image:
    p = smooth(27.75, 28.25, t)
    card = Image.new("RGBA", frame.size, (*IVORY, int(255 * p)))
    frame = Image.alpha_composite(frame, card)
    if p <= .01:
        return frame
    center = (W / 2, H * .42)
    scale = .78 + .22 * ease_back(smooth(27.90, 28.55, t))
    size = int(150 * scale)
    white = WHITE_STONE.resize((size, size), Image.Resampling.LANCZOS)
    black = BLACK_STONE.resize((size, size), Image.Resampling.LANCZOS)
    white.putalpha(white.getchannel("A").point(lambda a: int(a * p)))
    black.putalpha(black.getchannel("A").point(lambda a: int(a * p)))
    frame.alpha_composite(white, (int(center[0] - size * .08), int(center[1] - size * .10)))
    frame.alpha_composite(black, (int(center[0] - size * .72), int(center[1] - size * .76)))
    alpha = int(255 * smooth(28.18, 28.72, t))
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    label = "gostone.app"
    fnt = ImageFont.truetype(str(FONT_PATH), 55)
    draw.text((W / 2, H * .66), label, font=fnt, fill=(*INK, alpha), anchor="mm", stroke_width=0)
    line_p = smooth(28.50, 29.10, t)
    draw.rounded_rectangle((W / 2 - 168 * line_p, H * .71, W / 2 + 168 * line_p, H * .71 + 7), radius=4, fill=(*RED, alpha))
    frame.alpha_composite(layer)
    return frame


def render_frame(index: int) -> Image.Image:
    t = index / FPS
    if t < 8.30:
        accent = RED if t > 4.8 else MAGENTA if t > 3.3 else LIME
        frame = dark_background(t, accent)
        composite_board(frame, render_board_a(t), t)
    elif t < 17.40:
        frame = dark_background(t, VIOLET if t < 13 else RED)
        floating_stone(frame, t)
    elif t < 27.75:
        accent = RED if t > 24.8 else BLUE
        frame = dark_background(t, accent)
        composite_board(frame, render_board_b(t), t)
    else:
        frame = dark_background(t, (180, 180, 190))
    flash_transition(frame, t)
    if t >= 27.55:
        frame = end_card(frame, t)
    add_film(frame, index)
    return frame.convert("RGB")


def synth_audio(path: Path) -> None:
    rate = 48_000
    total = int(DURATION * rate)
    time = np.arange(total, dtype=np.float64) / rate
    rng = np.random.default_rng(4051)
    audio = 0.030 * np.sin(2 * np.pi * 43.65 * time)
    audio += 0.018 * np.sin(2 * np.pi * 87.3 * time + .4)
    noise = rng.normal(0, 1, total)
    audio += 0.018 * np.convolve(noise, np.ones(240) / 240, mode="same")

    def hit(at: float, gain: float = 1.0, bright: bool = False) -> None:
        start = int(at * rate)
        length = int((.75 if bright else 1.25) * rate)
        local = np.arange(length) / rate
        frequency = 154 if bright else 52
        wave_data = np.sin(2 * np.pi * frequency * local) * np.exp(-local * (11 if bright else 5.5))
        wave_data += .32 * np.sin(2 * np.pi * frequency * 2.03 * local) * np.exp(-local * 9)
        crack = rng.normal(0, 1, length) * np.exp(-local * 32)
        sound = (.18 * wave_data + .065 * crack) * gain
        end = min(total, start + length)
        audio[start:end] += sound[: end - start]

    def whoosh(at: float, length_s: float = .52, gain: float = 1.0) -> None:
        start = int(at * rate)
        length = int(length_s * rate)
        local = np.arange(length) / rate
        env = np.sin(np.pi * local / length_s) ** 2
        raw = rng.normal(0, 1, length)
        sound = np.concatenate(([0], np.diff(raw))) * env * .024 * gain
        end = min(total, start + length)
        audio[start:end] += sound[: end - start]

    move_times = (1.95, 3.55, 5.18, 18.95, 20.25, 21.55, 22.85, 24.15, 25.45)
    for at in move_times:
        whoosh(at - .20, .42, .85)
        hit(at + .28, .78, True)
    for at in (5.72, 11.06, 12.95, 15.35, 17.40, 25.98, 27.65):
        whoosh(at - .25, .58, 1.35)
        hit(at, 1.55 if at in (5.72, 25.98) else 1.05, False)

    # A restrained rhythmic pulse supports the frequent reference-style cuts.
    for at in np.arange(.7, 27.7, 60 / 108):
        hit(float(at), .20, True)
    fade = np.clip(time / .5, 0, 1) * np.clip((DURATION - time) / .65, 0, 1)
    audio *= fade
    audio = np.tanh(audio * 2.0) * .72
    pcm = np.int16(np.clip(audio, -1, 1) * 32767)
    stereo = np.column_stack((pcm, pcm)).ravel()
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(stereo.tobytes())


def find_ffmpeg(explicit: str | None) -> str:
    if explicit:
        return explicit
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        raise SystemExit("Pass --ffmpeg or install imageio-ffmpeg.") from exc


def render(output: Path, ffmpeg: str, preview_seconds: float | None) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    duration = preview_seconds if preview_seconds is not None else DURATION
    frames = int(duration * FPS)
    with tempfile.TemporaryDirectory(prefix="gostone-edit-") as temp_name:
        temp = Path(temp_name)
        silent = temp / "silent.mp4"
        audio = temp / "sound.wav"
        command = [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
            "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264",
            "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", str(silent),
        ]
        process = subprocess.Popen(command, stdin=subprocess.PIPE)
        assert process.stdin is not None
        for index in range(frames):
            process.stdin.write(np.asarray(render_frame(index), dtype=np.uint8).tobytes())
            if index % FPS == 0:
                print(f"Rendered {index // FPS:02d}s / {int(duration):02d}s", flush=True)
        process.stdin.close()
        if process.wait() != 0:
            raise SystemExit("Video encoding failed")
        if preview_seconds is not None:
            silent.replace(output)
            return
        synth_audio(audio)
        subprocess.run([
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(silent), "-i", str(audio),
            "-vf", "scale=1080:1920:flags=lanczos", "-c:v", "libx264",
            "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags",
            "+faststart", str(output),
        ], check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts" / "gostone-promo-30s.mp4")
    parser.add_argument("--ffmpeg")
    parser.add_argument("--preview-seconds", type=float)
    args = parser.parse_args()
    render(args.output, find_ffmpeg(args.ffmpeg), args.preview_seconds)
    print(f"Created {args.output}")


if __name__ == "__main__":
    main()
