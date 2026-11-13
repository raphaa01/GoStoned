"""Render a 30-second GoStone snapback edit synced to the reference pacing.

The board sequence is a verified legal 9x9 snapback. White appears to win a
capture, Black immediately recaptures three stones, and only then does the
captured-stone hero animation begin. Visuals and original sound share a
154 BPM grid derived from the supplied reference.
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
from PIL import Image, ImageDraw, ImageFilter, ImageFont


W, H = 720, 1280
FPS = 24
DURATION = 30.0
BPM = 154.0
BEAT = 60.0 / BPM
BOARD_SIZE = 900
MARGIN = 76
STEP = (BOARD_SIZE - 2 * MARGIN) / 8
ROOT = Path(__file__).resolve().parents[1]

INK = (7, 8, 11)
IVORY = (246, 244, 235)
WOOD = (169, 126, 86)
GRID = (34, 25, 20)
RED = (255, 48, 68)
MAGENTA = (236, 53, 199)
VIOLET = (127, 88, 255)
BLUE = (70, 173, 255)
LIME = (154, 255, 74)
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
    return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2


def board_point(coord: tuple[int, int]) -> tuple[float, float]:
    return MARGIN + coord[0] * STEP, MARGIN + coord[1] * STEP


def make_stone(size: int, color: str) -> Image.Image:
    scale = 3
    side = size * scale
    yy, xx = np.mgrid[0:side, 0:side]
    center = (side - 1) / 2
    nx, ny = (xx - center) / (side / 2), (yy - center) / (side / 2)
    radius_sq = nx * nx + ny * ny
    z = np.sqrt(np.clip(1 - radius_sq, 0, 1))
    light = np.clip(nx * -.48 + ny * -.58 + z * .74, 0, 1)
    rim = np.clip((radius_sq - .60) / .40, 0, 1)
    if color == "black":
        value = 13 + 55 * light + 21 * z - 9 * rim
        rgb = np.dstack((value * .88, value * .94, value * 1.04))
    else:
        value = 181 + 67 * light + 18 * z - 15 * rim
        rgb = np.dstack((value * 1.02, value, value * .95))
    alpha = np.where(radius_sq <= 1, np.clip((1.025 - np.sqrt(radius_sq)) * 2800, 0, 255), 0)
    stone = Image.fromarray(np.dstack((np.clip(rgb, 0, 255), alpha)).astype(np.uint8), "RGBA")
    highlight = Image.new("RGBA", stone.size, (0, 0, 0, 0))
    ImageDraw.Draw(highlight).ellipse(
        (side * .20, side * .14, side * .43, side * .30),
        fill=(255, 255, 255, 53 if color == "black" else 86),
    )
    stone.alpha_composite(highlight.filter(ImageFilter.GaussianBlur(side * .035)))
    return stone.resize((size, size), Image.Resampling.LANCZOS)


BLACK_STONE = make_stone(90, "black")
WHITE_STONE = make_stone(90, "white")


def make_shadow() -> Image.Image:
    layer = Image.new("RGBA", (116, 116), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse((12, 20, 108, 105), fill=(0, 0, 0, 135))
    return layer.filter(ImageFilter.GaussianBlur(10))


STONE_SHADOW = make_shadow()


def make_board() -> Image.Image:
    yy, xx = np.mgrid[0:BOARD_SIZE, 0:BOARD_SIZE]
    light = 1 + .10 * np.exp(-(((xx - 260) / 600) ** 2 + ((yy - 190) / 520) ** 2))
    vignette = 1 - .20 * np.clip(((xx - BOARD_SIZE / 2) / 640) ** 2 + ((yy - BOARD_SIZE / 2) / 640) ** 2, 0, 1)
    array = np.zeros((BOARD_SIZE, BOARD_SIZE, 4), dtype=np.uint8)
    for channel, value in enumerate(WOOD):
        array[:, :, channel] = np.clip(value * light * vignette, 0, 255)
    array[:, :, 3] = 255
    board = Image.fromarray(array, "RGBA")
    draw = ImageDraw.Draw(board)
    for index in range(9):
        position = MARGIN + index * STEP
        draw.line((MARGIN, position, BOARD_SIZE - MARGIN, position), fill=(*GRID, 225), width=4)
        draw.line((position, MARGIN, position, BOARD_SIZE - MARGIN), fill=(*GRID, 225), width=4)
    for coord in ((2, 2), (6, 2), (4, 4), (2, 6), (6, 6)):
        x, y = board_point(coord)
        draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill=(*GRID, 242))
    return board


CLEAN_BOARD = make_board()

# Source shape: the canonical 9x9 snapback example from the SGF package docs.
# The sequence was replayed through this repository's BoardState: White captures
# one black stone on move four; Black immediately recaptures three white stones.
INITIAL_WHITE = {(2, 0), (4, 0), (1, 1), (4, 1), (1, 2), (1, 3), (1, 4), (1, 5)}
INITIAL_BLACK = {(5, 0), (5, 1), (2, 2), (3, 2), (4, 2), (5, 2)}
MOVES = (
    ("black", (2, 1)),
    ("white", (1, 0)),
    ("black", (3, 0)),
    ("white", (3, 1)),  # captures the black stone at (3, 0)
    ("black", (3, 0)),  # snapback: captures the three-stone white group
)
MOVE_TIMES = (8 * BEAT, 14 * BEAT, 20 * BEAT, 32 * BEAT, 44 * BEAT)
FIRST_CAPTURE = MOVE_TIMES[3]
FINAL_CAPTURE = MOVE_TIMES[4]
FIRST_CAPTURED_BLACK = (3, 0)
FINAL_CAPTURED_WHITE = {(3, 1), (4, 0), (4, 1)}
HERO_START = 51 * BEAT
SHATTER_TIME = 59 * BEAT
MARK_START = 64 * BEAT
END_CARD_START = 70 * BEAT


def background(t: float, accent: tuple[int, int, int]) -> Image.Image:
    base = np.zeros((H, W, 3), dtype=np.float32)
    base[:] = (5, 6, 9)
    intensity = .08 + .06 * smooth(0, FINAL_CAPTURE, t)
    radial = np.exp(-(((XX - W * .53) / 450) ** 2 + ((YY - H * .52) / 650) ** 2))
    for channel in range(3):
        base[:, :, channel] += radial * accent[channel] * intensity
    vignette = 1 - .70 * np.clip(((XX - W / 2) / (W * .72)) ** 2 + ((YY - H / 2) / (H * .72)) ** 2, 0, 1)
    base *= vignette[:, :, None]
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


def glow_blob(canvas: Image.Image, center: tuple[float, float], radius: float, color: tuple[int, int, int], alpha: int) -> None:
    pad = int(radius * 2.1)
    blob = Image.new("RGBA", (pad * 2, pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(blob).ellipse((pad - radius, pad - radius, pad + radius, pad + radius), fill=(*color, alpha))
    blob = blob.filter(ImageFilter.GaussianBlur(max(3, int(radius * .42))))
    canvas.alpha_composite(blob, (int(center[0] - pad), int(center[1] - pad)))


def draw_stone(
    board: Image.Image,
    coord: tuple[int, int],
    color: str,
    *,
    scale: float = 1,
    opacity: float = 1,
    y_offset: float = 0,
    accent: tuple[int, int, int] | None = None,
    glow: float = 0,
) -> None:
    x, y = board_point(coord)
    size = max(5, int(90 * scale))
    shadow_size = max(6, int(116 * scale))
    shadow = STONE_SHADOW if shadow_size == 116 else STONE_SHADOW.resize((shadow_size, shadow_size), Image.Resampling.BILINEAR)
    if opacity < 1:
        shadow = shadow.copy()
        shadow.putalpha(shadow.getchannel("A").point(lambda alpha: int(alpha * opacity)))
    board.alpha_composite(shadow, (int(x - shadow_size / 2 + 5), int(y - shadow_size / 2 + 11 + y_offset)))
    if accent and glow > 0:
        glow_blob(board, (x, y + y_offset), 56 + 18 * glow, accent, int(82 * glow * opacity))
    source = BLACK_STONE if color == "black" else WHITE_STONE
    stone = source.copy() if size == 90 else source.resize((size, size), Image.Resampling.LANCZOS)
    if opacity < 1:
        stone.putalpha(stone.getchannel("A").point(lambda alpha: int(alpha * opacity)))
    board.alpha_composite(stone, (int(x - size / 2), int(y - size / 2 + y_offset)))


def move_marker(board: Image.Image, coord: tuple[int, int], color: tuple[int, int, int], strength: float, t: float) -> None:
    if strength <= 0:
        return
    x, y = board_point(coord)
    layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    radius = 44 + 7 * math.sin(t * math.tau / BEAT)
    draw.rounded_rectangle((x - 51, y - 51, x + 51, y + 51), radius=12, outline=(*color, int(240 * strength)), width=7)
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), outline=(*color, int(130 * strength)), width=4)
    board.alpha_composite(layer.filter(ImageFilter.GaussianBlur(18)))
    board.alpha_composite(layer)


def draw_placement(board: Image.Image, t: float, at: float, color: str, coord: tuple[int, int], accent: tuple[int, int, int]) -> None:
    if t < at - .62:
        return
    if t < at - .20:
        move_marker(board, coord, accent, smooth(at - .62, at - .22, t), t)
        return
    progress = smooth(at - .20, at, t)
    y_offset = -235 * (1 - progress)
    scale = .70 + .30 * ease_back(progress)
    impact = pulse(t, at, .15)
    draw_stone(board, coord, color, scale=scale, y_offset=y_offset, accent=accent, glow=.35 + 1.55 * impact if impact > .02 else 0)
    if impact > .03:
        x, y = board_point(coord)
        ring = Image.new("RGBA", board.size, (0, 0, 0, 0))
        radius = 34 + 105 * smooth(at - .04, at + .42, t)
        ImageDraw.Draw(ring).ellipse((x - radius, y - radius, x + radius, y + radius), outline=(*accent, int(230 * impact)), width=8)
        board.alpha_composite(ring)


def render_snapback_board(t: float) -> Image.Image:
    board = CLEAN_BOARD.copy()
    for coord in INITIAL_BLACK:
        draw_stone(board, coord, "black")
    for coord in INITIAL_WHITE:
        if coord in FINAL_CAPTURED_WHITE and t >= FINAL_CAPTURE + .08:
            order = sorted(FINAL_CAPTURED_WHITE).index(coord)
            removal = smooth(FINAL_CAPTURE + .12 + order * BEAT * .70, FINAL_CAPTURE + 1.25 + order * BEAT * .70, t)
            draw_stone(board, coord, "white", scale=1 - .52 * removal, opacity=1 - removal, y_offset=-310 * removal, accent=RED, glow=1.6 * (1 - removal))
        else:
            pressure = smooth(FIRST_CAPTURE + .7, FINAL_CAPTURE - .4, t) if coord in FINAL_CAPTURED_WHITE else 0
            draw_stone(board, coord, "white", accent=RED, glow=.60 * pressure)

    # First three moves remain until White's apparent capture.
    draw_placement(board, t, MOVE_TIMES[0], "black", MOVES[0][1], LIME)
    draw_placement(board, t, MOVE_TIMES[1], "white", MOVES[1][1], MAGENTA)

    if t < FIRST_CAPTURE + .72:
        if t >= MOVE_TIMES[2] - .62:
            if t < MOVE_TIMES[2]:
                draw_placement(board, t, MOVE_TIMES[2], "black", MOVES[2][1], RED)
            else:
                removal = smooth(FIRST_CAPTURE + .08, FIRST_CAPTURE + .70, t)
                draw_stone(board, FIRST_CAPTURED_BLACK, "black", scale=1 - .45 * removal, opacity=1 - removal, y_offset=-150 * removal, accent=BLUE, glow=1.35 * (1 - removal))
    if t < FINAL_CAPTURE + .08:
        if t >= FIRST_CAPTURE - .62:
            draw_placement(board, t, FIRST_CAPTURE, "white", MOVES[3][1], BLUE)
    else:
        # The just-played white stone is the first of the three snapback captures to lift.
        removal = smooth(FINAL_CAPTURE + .12, FINAL_CAPTURE + 1.25, t)
        draw_stone(
            board,
            MOVES[3][1],
            "white",
            scale=1 - .52 * removal,
            opacity=1 - removal,
            y_offset=-310 * removal,
            accent=RED,
            glow=1.6 * (1 - removal),
        )

    if t >= FINAL_CAPTURE - .62:
        draw_placement(board, t, FINAL_CAPTURE, "black", MOVES[4][1], RED)

    if FIRST_CAPTURE - .05 < t < FIRST_CAPTURE + .90:
        capture_sparks(board, t, FIRST_CAPTURE, FIRST_CAPTURED_BLACK, BLUE, 35)
    if FINAL_CAPTURE - .08 < t < HERO_START:
        cx = sum(board_point(coord)[0] for coord in FINAL_CAPTURED_WHITE) / 3
        cy = sum(board_point(coord)[1] for coord in FINAL_CAPTURED_WHITE) / 3
        capture_sparks(board, t, FINAL_CAPTURE, (cx, cy), RED, 110, raw_point=True)
    return board


def capture_sparks(
    board: Image.Image,
    t: float,
    at: float,
    origin: tuple[float, float] | tuple[int, int],
    color: tuple[int, int, int],
    count: int,
    *,
    raw_point: bool = False,
) -> None:
    if not at - .08 < t < at + 1.8:
        return
    cx, cy = origin if raw_point else board_point(origin)  # type: ignore[arg-type]
    life = smooth(at - .08, at + .15, t) * (1 - smooth(at + 1.1, at + 1.8, t))
    age = max(0, t - at)
    rng = random.Random(908 + count)
    layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for index in range(count):
        angle = rng.random() * math.tau
        speed = 45 + rng.random() * 235
        x = cx + math.cos(angle) * speed * age
        y = cy + math.sin(angle) * speed * age - 65 * age
        radius = 2 + rng.random() * 5
        spark_color = GOLD if index % 6 == 0 else color
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*spark_color, int(225 * life)))
    board.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1.3)))


def camera_for_time(t: float) -> tuple[float, float, float, float]:
    if t < MOVE_TIMES[0]:
        progress = smooth(0, MOVE_TIMES[0], t)
        return .78 + .08 * progress, -4.5, W * .50, H * .56
    if t < MOVE_TIMES[2]:
        return 1.35, 1.2, W * .56, H * .76
    if t < FIRST_CAPTURE:
        return 1.58, -1.4, W * .48, H * .80
    if t < FINAL_CAPTURE:
        return 1.70, 1.0, W * .45, H * .83
    return 1.82 + .18 * smooth(FINAL_CAPTURE, HERO_START, t), -.5, W * .43, H * .86


def composite_board(frame: Image.Image, board: Image.Image, t: float) -> None:
    scale, angle, center_x, center_y = camera_for_time(t)
    side = int(BOARD_SIZE * scale)
    board = board.resize((side, int(side * .92)), Image.Resampling.LANCZOS)
    board = board.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    position = (int(center_x - board.width / 2), int(center_y - board.height / 2))
    shadow = board.getchannel("A").filter(ImageFilter.GaussianBlur(38))
    shadow_layer = Image.new("RGBA", board.size, (0, 0, 0, 145))
    shadow_layer.putalpha(shadow.point(lambda alpha: int(alpha * .62)))
    frame.alpha_composite(shadow_layer, (position[0] + 8, position[1] + 32))
    frame.alpha_composite(board, position)


def smoke_aura(frame: Image.Image, t: float, center: tuple[float, float], intensity: float) -> None:
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    rng = random.Random(412)
    for index in range(20):
        angle = index * math.tau / 20 + t * (.18 + (index % 3) * .03)
        distance = 105 + 65 * math.sin(t * .45 + index * 1.4) ** 2
        x = center[0] + math.cos(angle) * distance
        y = center[1] + math.sin(angle) * distance * .70
        radius = 32 + rng.random() * 42
        color = BLUE if index % 3 else MAGENTA if index % 5 else RED
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, int((18 + index % 4 * 7) * intensity)))
    frame.alpha_composite(layer.filter(ImageFilter.GaussianBlur(30)))


def lightning_arc(layer: Image.Image, start: tuple[float, float], end: tuple[float, float], seed: int, alpha: int) -> None:
    rng = random.Random(seed)
    points = []
    for index in range(12):
        progress = index / 11
        x = start[0] * (1 - progress) + end[0] * progress
        y = start[1] * (1 - progress) + end[1] * progress
        if 0 < index < 11:
            x += rng.uniform(-14, 14)
            y += rng.uniform(-12, 12)
        points.append((x, y))
    ImageDraw.Draw(layer).line(points, fill=(*BLUE, alpha), width=3, joint="curve")


def cracked_stone_sprite(size: int, crack: float) -> Image.Image:
    stone = WHITE_STONE.resize((size, size), Image.Resampling.LANCZOS)
    if crack <= 0:
        return stone
    overlay = Image.new("RGBA", stone.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    center = size / 2
    branches = [
        [(center, center), (.63 * size, .38 * size), (.78 * size, .27 * size)],
        [(center, center), (.42 * size, .58 * size), (.30 * size, .76 * size)],
        [(center, center), (.57 * size, .66 * size), (.66 * size, .83 * size)],
        [(.42 * size, .58 * size), (.24 * size, .56 * size)],
        [(.63 * size, .38 * size), (.69 * size, .19 * size)],
    ]
    visible = max(1, int(math.ceil(len(branches) * crack)))
    for branch in branches[:visible]:
        end_count = max(2, int(1 + (len(branch) - 1) * crack * len(branches)))
        draw.line(branch[:end_count], fill=(65, 70, 88, int(230 * crack)), width=max(2, size // 80), joint="curve")
    mask = stone.getchannel("A")
    overlay.putalpha(Image.composite(overlay.getchannel("A"), Image.new("L", stone.size, 0), mask))
    stone.alpha_composite(overlay)
    return stone


def render_captured_hero(frame: Image.Image, t: float) -> None:
    local = t - HERO_START
    duration = SHATTER_TIME - HERO_START
    progress = clamp(local / duration)
    center = (W * .50, H * (.53 - .025 * smooth(0, 1, progress)))
    entrance = smooth(0, .14, progress)
    smoke_aura(frame, t, center, entrance)
    glow_blob(frame, center, 190 - 28 * progress, VIOLET, int(135 * entrance))
    glow_blob(frame, center, 105, BLUE, int(104 * entrance))

    crack = smooth(.36, .92, progress)
    size = int(250 + 25 * smooth(0, 1, progress))
    stone = cracked_stone_sprite(size, crack)
    stone.putalpha(stone.getchannel("A").point(lambda alpha: int(alpha * entrance)))
    frame.alpha_composite(stone, (int(center[0] - size / 2), int(center[1] - size / 2)))

    arcs = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    arc_strength = smooth(.20, .48, progress)
    for index in range(6):
        angle = index * math.tau / 6 + t * .35
        start = (center[0] + math.cos(angle) * 135, center[1] + math.sin(angle) * 108)
        end = (center[0] + math.cos(angle + .52) * 220, center[1] + math.sin(angle + .52) * 175)
        lightning_arc(arcs, start, end, 2200 + index + int(t * 7), int(175 * arc_strength))
    frame.alpha_composite(arcs.filter(ImageFilter.GaussianBlur(10)))
    frame.alpha_composite(arcs)


def render_shatter(frame: Image.Image, t: float) -> None:
    progress = smooth(SHATTER_TIME, SHATTER_TIME + 1.55, t)
    fade = 1 - smooth(SHATTER_TIME + 1.05, SHATTER_TIME + 1.85, t)
    center = (W * .50, H * .505)
    glow_blob(frame, center, 205 + 80 * progress, (215, 225, 255), int(180 * fade))
    rng = random.Random(7331)
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for index in range(28):
        angle = rng.random() * math.tau
        speed = 75 + rng.random() * 255
        distance = speed * progress
        x = center[0] + math.cos(angle) * distance
        y = center[1] + math.sin(angle) * distance - 42 * progress
        size = 7 + rng.random() * 18
        tangent = angle + math.pi / 2
        polygon = [
            (x + math.cos(angle) * size, y + math.sin(angle) * size),
            (x + math.cos(tangent) * size * .65, y + math.sin(tangent) * size * .65),
            (x - math.cos(angle) * size * .7, y - math.sin(angle) * size * .7),
        ]
        draw.polygon(polygon, fill=(235, 234, 226, int(235 * fade)))
    for index in range(90):
        angle = rng.random() * math.tau
        speed = 90 + rng.random() * 320
        x = center[0] + math.cos(angle) * speed * progress
        y = center[1] + math.sin(angle) * speed * progress
        radius = 1 + rng.random() * 4
        color = BLUE if index % 3 else MAGENTA if index % 5 else RED
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, int(210 * fade)))
    frame.alpha_composite(layer.filter(ImageFilter.GaussianBlur(.8)))


def render_brand_mark(frame: Image.Image, t: float) -> None:
    progress = smooth(MARK_START, MARK_START + .85, t)
    center = (W / 2, H * .50)
    smoke_aura(frame, t, center, progress * .65)
    glow_blob(frame, center, 175, (175, 185, 255), int(105 * progress))
    size = int(218 * (.72 + .28 * ease_back(progress)))
    white = WHITE_STONE.resize((size, size), Image.Resampling.LANCZOS)
    black = BLACK_STONE.resize((size, size), Image.Resampling.LANCZOS)
    white.putalpha(white.getchannel("A").point(lambda alpha: int(alpha * progress)))
    black.putalpha(black.getchannel("A").point(lambda alpha: int(alpha * progress)))
    frame.alpha_composite(white, (int(center[0] - size * .08), int(center[1] - size * .10)))
    frame.alpha_composite(black, (int(center[0] - size * .72), int(center[1] - size * .76)))


def flash(frame: Image.Image, t: float) -> None:
    strength = max(
        pulse(t, FIRST_CAPTURE, .10) * .55,
        pulse(t, FINAL_CAPTURE, .12),
        pulse(t, HERO_START, .10) * .75,
        pulse(t, SHATTER_TIME, .12),
        pulse(t, MARK_START, .10) * .65,
        pulse(t, END_CARD_START, .12),
    )
    if strength > .01:
        frame.alpha_composite(Image.new("RGBA", frame.size, (248, 248, 255, int(220 * strength))))


def add_film(frame: Image.Image, index: int) -> None:
    rng = np.random.default_rng(5500 + index % 13)
    noise = rng.normal(128, 19, (H // 5, W // 5)).clip(0, 255).astype(np.uint8)
    noise_image = Image.fromarray(noise, "L").resize((W, H), Image.Resampling.BILINEAR)
    frame.alpha_composite(Image.merge("RGBA", (noise_image, noise_image, noise_image, Image.new("L", (W, H), 8))))


def end_card(frame: Image.Image, t: float) -> Image.Image:
    progress = smooth(END_CARD_START, END_CARD_START + .48, t)
    frame = Image.alpha_composite(frame, Image.new("RGBA", frame.size, (*IVORY, int(255 * progress))))
    center = (W / 2, H * .42)
    logo_progress = ease_back(smooth(END_CARD_START + .12, END_CARD_START + .70, t))
    size = max(1, int(150 * (.78 + .22 * logo_progress)))
    white = WHITE_STONE.resize((size, size), Image.Resampling.LANCZOS)
    black = BLACK_STONE.resize((size, size), Image.Resampling.LANCZOS)
    white.putalpha(white.getchannel("A").point(lambda alpha: int(alpha * progress)))
    black.putalpha(black.getchannel("A").point(lambda alpha: int(alpha * progress)))
    frame.alpha_composite(white, (int(center[0] - size * .08), int(center[1] - size * .10)))
    frame.alpha_composite(black, (int(center[0] - size * .72), int(center[1] - size * .76)))
    alpha = int(255 * smooth(END_CARD_START + .45, END_CARD_START + .95, t))
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.text((W / 2, H * .66), "gostone.app", font=ImageFont.truetype(str(FONT_PATH), 55), fill=(*INK, alpha), anchor="mm")
    underline = smooth(END_CARD_START + .72, END_CARD_START + 1.22, t)
    draw.rounded_rectangle((W / 2 - 168 * underline, H * .71, W / 2 + 168 * underline, H * .71 + 7), radius=4, fill=(*RED, alpha))
    frame.alpha_composite(layer)
    return frame


def render_frame(index: int) -> Image.Image:
    t = index / FPS
    if t < HERO_START:
        build = smooth(FIRST_CAPTURE + .8, FINAL_CAPTURE, t)
        accent = tuple(int(BLUE[channel] * (1 - build) + RED[channel] * build) for channel in range(3))
        frame = background(t, accent)
        composite_board(frame, render_snapback_board(t), t)
    elif t < SHATTER_TIME:
        frame = background(t, VIOLET)
        render_captured_hero(frame, t)
    elif t < MARK_START:
        frame = background(t, MAGENTA)
        render_shatter(frame, t)
    elif t < END_CARD_START:
        frame = background(t, (176, 185, 255))
        render_brand_mark(frame, t)
    else:
        frame = background(t, (170, 175, 190))
    flash(frame, t)
    if t >= END_CARD_START - .05:
        frame = end_card(frame, t)
    add_film(frame, index)
    return frame.convert("RGB")


def synth_audio(path: Path) -> None:
    rate = 48_000
    total = int(DURATION * rate)
    time = np.arange(total, dtype=np.float64) / rate
    rng = np.random.default_rng(4051)
    audio = np.zeros(total, dtype=np.float64)

    frequency = 39 + 17 * np.clip(time / FINAL_CAPTURE, 0, 1) ** 1.7
    phase = 2 * np.pi * np.cumsum(frequency) / rate
    drone_gain = .050 + .060 * np.clip(time / FINAL_CAPTURE, 0, 1)
    audio += np.sin(phase) * drone_gain
    audio += np.sin(phase * 2.005 + .4) * drone_gain * .32
    noise = rng.normal(0, 1, total)
    audio += np.convolve(noise, np.ones(260) / 260, mode="same") * (.022 + .034 * np.clip(time / FINAL_CAPTURE, 0, 1))

    def mix(at: float, sound: np.ndarray) -> None:
        start = max(0, int(at * rate))
        end = min(total, start + len(sound))
        if end > start:
            audio[start:end] += sound[: end - start]

    def kick(at: float, gain: float) -> None:
        local = np.arange(int(.55 * rate)) / rate
        sweep = 92 * np.exp(-local * 20) + 43
        local_phase = 2 * np.pi * np.cumsum(sweep) / rate
        sound = np.sin(local_phase) * np.exp(-local * 9.5) * gain
        sound += rng.normal(0, 1, len(local)) * np.exp(-local * 55) * .08 * gain
        mix(at, sound)

    def stone_hit(at: float, color: str, gain: float) -> None:
        local = np.arange(int(.48 * rate)) / rate
        base = 188 if color == "white" else 122
        tone = np.sin(2 * np.pi * base * local) * np.exp(-local * 15)
        tone += .42 * np.sin(2 * np.pi * base * 2.07 * local) * np.exp(-local * 19)
        crack = rng.normal(0, 1, len(local)) * np.exp(-local * 42)
        mix(at, (tone * .16 + crack * .055) * gain)

    def hat(at: float, gain: float) -> None:
        local = np.arange(int(.12 * rate)) / rate
        raw = rng.normal(0, 1, len(local))
        mix(at, np.concatenate(([0], np.diff(raw))) * np.exp(-local * 42) * .028 * gain)

    def clap(at: float, gain: float) -> None:
        local = np.arange(int(.22 * rate)) / rate
        raw = rng.normal(0, 1, len(local))
        bright = np.concatenate(([0], np.diff(raw)))
        envelope = np.exp(-local * 24)
        envelope += .42 * np.exp(-np.maximum(0, local - .028) * 34) * (local >= .028)
        mix(at, bright * envelope * .018 * gain)

    def riser(start: float, end: float, gain: float) -> None:
        length = int((end - start) * rate)
        local = np.arange(length) / rate
        progress = local / max(1e-6, end - start)
        raw = rng.normal(0, 1, length)
        bright = np.concatenate(([0], np.diff(raw)))
        sound = bright * progress ** 1.9 * .018 * gain
        rising_frequency = 170 + 760 * progress ** 2
        local_phase = 2 * np.pi * np.cumsum(rising_frequency) / rate
        sound += np.sin(local_phase) * progress ** 2 * .035 * gain
        mix(start, sound)

    def impact(at: float, gain: float) -> None:
        local = np.arange(int(2.0 * rate)) / rate
        sub = np.sin(2 * np.pi * 47 * local) * np.exp(-local * 3.5)
        metal = np.sin(2 * np.pi * 191 * local) * np.exp(-local * 8)
        burst = rng.normal(0, 1, len(local)) * np.exp(-local * 18)
        mix(at, (sub * .24 + metal * .07 + burst * .08) * gain)

    beat_count = int(DURATION / BEAT) + 1
    for beat_index in range(beat_count):
        at = beat_index * BEAT
        if at < MOVE_TIMES[0]:
            if beat_index % 4 == 0:
                kick(at, .46)
        elif at < FIRST_CAPTURE:
            if beat_index % 2 == 0:
                kick(at, .68)
            hat(at, .58)
        elif at < FINAL_CAPTURE:
            kick(at, .72 if beat_index % 2 == 0 else .38)
            hat(at, .88)
            if beat_index % 2 == 1:
                clap(at, .55)
        elif at < HERO_START:
            kick(at, .42)
            hat(at, .74)
        elif at < SHATTER_TIME:
            if beat_index % 2 == 0:
                kick(at, .50)
            hat(at, .66)

    for index, ((color, _), at) in enumerate(zip(MOVES, MOVE_TIMES)):
        stone_hit(at, color, .90 + index * .10)
    riser(MOVE_TIMES[2] + .4, FIRST_CAPTURE, .72)
    impact(FIRST_CAPTURE, .78)
    riser(FIRST_CAPTURE + .75, FINAL_CAPTURE, 1.55)
    impact(FINAL_CAPTURE, 2.35)
    for index in range(3):
        stone_hit(FINAL_CAPTURE + .28 + index * BEAT * .48, "white", .72)
    riser(HERO_START, SHATTER_TIME, 1.20)
    impact(SHATTER_TIME, 1.85)
    stone_hit(MARK_START, "white", .90)
    stone_hit(END_CARD_START, "white", 1.12)

    local = np.arange(int(1.8 * rate)) / rate
    chime = (np.sin(2 * np.pi * 392 * local) + .55 * np.sin(2 * np.pi * 588 * local)) * np.exp(-local * 2.6) * .07
    mix(END_CARD_START, chime)
    duck = 1 - .52 * np.exp(-((time - (FINAL_CAPTURE + .23)) / .42) ** 2)
    audio *= duck
    fade = np.clip(time / .45, 0, 1) * np.clip((DURATION - time) / .65, 0, 1)
    audio *= fade
    audio = np.tanh(audio * 3.0)
    audio = audio / max(1e-9, float(np.max(np.abs(audio)))) * .87
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
    frame_count = int(duration * FPS)
    with tempfile.TemporaryDirectory(prefix="gostone-snapback-") as temp_name:
        temp = Path(temp_name)
        silent = temp / "silent.mp4"
        audio = temp / "sound.wav"
        command = [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo",
            "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
            "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "17",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(silent),
        ]
        process = subprocess.Popen(command, stdin=subprocess.PIPE)
        assert process.stdin is not None
        for index in range(frame_count):
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
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(silent),
            "-i", str(audio), "-vf", "scale=1080:1920:flags=lanczos", "-c:v", "libx264",
            "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac",
            "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(output),
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
