"""Render a 30-second, beat-synchronised GoStone ladder edit.

The story is one verified legal 9x9 ladder: twenty-three connected moves build
toward a twelve-stone capture. Visual cuts and original sound design share a
154 BPM grid derived from the supplied reference video's pacing.
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
RED = (255, 50, 70)
MAGENTA = (235, 53, 197)
VIOLET = (128, 88, 255)
BLUE = (72, 171, 255)
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
    draw = ImageDraw.Draw(highlight)
    draw.ellipse((side * .20, side * .14, side * .43, side * .30), fill=(255, 255, 255, 53 if color == "black" else 86))
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
    """Flat, precise board with exactly nine horizontal and vertical lines."""
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

# This exact sequence was replayed through the repository's BoardState rules:
# it is legal, alternates correctly, and the final black move captures 12 stones.
INITIAL_BLACK = {(1, 2), (2, 1), (3, 1)}
INITIAL_WHITE = {(2, 2)}
LADDER_MOVES = (
    ("black", (2, 3)), ("white", (3, 2)),
    ("black", (4, 2)), ("white", (3, 3)),
    ("black", (3, 4)), ("white", (4, 3)),
    ("black", (5, 3)), ("white", (4, 4)),
    ("black", (4, 5)), ("white", (5, 4)),
    ("black", (6, 4)), ("white", (5, 5)),
    ("black", (5, 6)), ("white", (6, 5)),
    ("black", (7, 5)), ("white", (6, 6)),
    ("black", (6, 7)), ("white", (7, 6)),
    ("black", (8, 6)), ("white", (7, 7)),
    ("black", (7, 8)), ("white", (8, 7)),
    ("black", (8, 8)),
)

# Every move lands on the 154 BPM grid. The visual interlude is a deliberate
# hold in the same sequence, not a second unrelated position.
MOVE_TIMES = (
    6 * BEAT, 8 * BEAT, 10 * BEAT, 12 * BEAT, 14 * BEAT, 16 * BEAT, 18 * BEAT,
    28 * BEAT, 30 * BEAT, 32 * BEAT, 34 * BEAT, 36 * BEAT, 38 * BEAT,
    40 * BEAT, 42 * BEAT, 44 * BEAT, 46 * BEAT, 48 * BEAT,
    54 * BEAT, 56 * BEAT, 58 * BEAT, 60 * BEAT, 62 * BEAT,
)
INTERLUDE_START = 20 * BEAT
INTERLUDE_END = 28 * BEAT
BUILD_START = 49 * BEAT
FINAL_CAPTURE = MOVE_TIMES[-1]
END_CARD_START = 70 * BEAT
CAPTURED_WHITE = INITIAL_WHITE | {coord for index, (color, coord) in enumerate(LADDER_MOVES) if color == "white"}


def background(t: float, accent: tuple[int, int, int]) -> Image.Image:
    base = np.zeros((H, W, 3), dtype=np.float32)
    base[:] = (5, 6, 9)
    intensity = .08 + .05 * smooth(0, FINAL_CAPTURE, t)
    cx, cy = W * .53, H * .52
    radial = np.exp(-(((XX - cx) / 450) ** 2 + ((YY - cy) / 650) ** 2))
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
        shadow.putalpha(shadow.getchannel("A").point(lambda a: int(a * opacity)))
    board.alpha_composite(shadow, (int(x - shadow_size / 2 + 5), int(y - shadow_size / 2 + 11 + y_offset)))
    if accent and glow > 0:
        glow_blob(board, (x, y + y_offset), 56 + 18 * glow, accent, int(82 * glow * opacity))
    source = BLACK_STONE if color == "black" else WHITE_STONE
    stone = source.copy() if size == 90 else source.resize((size, size), Image.Resampling.LANCZOS)
    if opacity < 1:
        stone.putalpha(stone.getchannel("A").point(lambda a: int(a * opacity)))
    board.alpha_composite(stone, (int(x - size / 2), int(y - size / 2 + y_offset)))


def marker(board: Image.Image, coord: tuple[int, int], color: tuple[int, int, int], strength: float, t: float) -> None:
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


def move_accent(index: int) -> tuple[int, int, int]:
    if index == len(LADDER_MOVES) - 1:
        return RED
    return LIME if LADDER_MOVES[index][0] == "black" else MAGENTA


def render_ladder_board(t: float) -> Image.Image:
    board = CLEAN_BOARD.copy()
    for coord in INITIAL_BLACK:
        draw_stone(board, coord, "black")
    final_removal = smooth(FINAL_CAPTURE + .12, FINAL_CAPTURE + 1.38, t)
    if t < FINAL_CAPTURE + 1.45:
        for coord in INITIAL_WHITE:
            draw_stone(board, coord, "white", scale=1 - .48 * final_removal, opacity=1 - final_removal, y_offset=-128 * final_removal, accent=RED, glow=1.55 * final_removal)

    for index, ((color, coord), at) in enumerate(zip(LADDER_MOVES, MOVE_TIMES)):
        if t < at - .58:
            continue
        accent = move_accent(index)
        if t < at - .20:
            marker(board, coord, accent, smooth(at - .58, at - .22, t), t)
            continue
        if color == "white" and t >= FINAL_CAPTURE + .12:
            removal = smooth(FINAL_CAPTURE + .12 + index * .008, FINAL_CAPTURE + 1.32 + index * .008, t)
        else:
            removal = 0
        progress = smooth(at - .20, at, t)
        y_offset = -230 * (1 - progress) - 128 * removal
        scale = (.70 + .30 * ease_back(progress)) * (1 - .48 * removal)
        opacity = 1 - removal
        impact = pulse(t, at, .15)
        draw_stone(board, coord, color, scale=scale, opacity=opacity, y_offset=y_offset, accent=accent, glow=.35 + 1.55 * impact if impact > .02 else 0)
        if impact > .03:
            x, y = board_point(coord)
            layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(layer)
            ring_radius = 34 + 105 * smooth(at - .04, at + .42, t)
            draw.ellipse((x - ring_radius, y - ring_radius, x + ring_radius, y + ring_radius), outline=(*accent, int(230 * impact)), width=8)
            board.alpha_composite(layer)

    if FINAL_CAPTURE - .08 < t < FINAL_CAPTURE + 1.8:
        capture_particles(board, t)
    return board


def capture_particles(board: Image.Image, t: float) -> None:
    rng = random.Random(991)
    life = smooth(FINAL_CAPTURE - .08, FINAL_CAPTURE + .18, t) * (1 - smooth(FINAL_CAPTURE + 1.15, FINAL_CAPTURE + 1.80, t))
    age = max(0, t - FINAL_CAPTURE)
    centers = [board_point(coord) for coord in CAPTURED_WHITE]
    cx = sum(x for x, _ in centers) / len(centers)
    cy = sum(y for _, y in centers) / len(centers)
    layer = Image.new("RGBA", board.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for index in range(150):
        angle = rng.random() * math.tau
        speed = 45 + rng.random() * 250
        x = cx + math.cos(angle) * speed * age
        y = cy + math.sin(angle) * speed * age - 72 * age
        radius = 2 + rng.random() * 5
        color = GOLD if index % 6 == 0 else RED
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*color, int(225 * life)))
    board.alpha_composite(layer.filter(ImageFilter.GaussianBlur(1.4)))


def camera_for_time(t: float) -> tuple[float, float, float, float]:
    """Deliberate cuts follow the ladder diagonally; no random camera wobble."""
    if t < MOVE_TIMES[0]:
        p = smooth(0, MOVE_TIMES[0], t)
        return .76 + .08 * p, -4.5, W * .51, H * .55
    if t < MOVE_TIMES[3]:
        return 1.42, 1.5, W * .68, H * .73
    if t < INTERLUDE_START:
        return 1.52, -1.8, W * .58, H * .65
    if t < MOVE_TIMES[11]:
        return 1.44, 1.4, W * .48, H * .57
    if t < MOVE_TIMES[18]:
        return 1.55, -2.2, W * .30, H * .42
    if t < MOVE_TIMES[21]:
        return 1.65, 1.2, W * .18, H * .28
    return 1.78 + .10 * smooth(MOVE_TIMES[21], FINAL_CAPTURE + 1.5, t), -.7, W * .08, H * .18


def composite_board(frame: Image.Image, board: Image.Image, t: float) -> None:
    scale, angle, center_x, center_y = camera_for_time(t)
    side = int(BOARD_SIZE * scale)
    board = board.resize((side, int(side * .92)), Image.Resampling.LANCZOS)
    board = board.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    position = (int(center_x - board.width / 2), int(center_y - board.height / 2))
    shadow = board.getchannel("A").filter(ImageFilter.GaussianBlur(38))
    shadow_layer = Image.new("RGBA", board.size, (0, 0, 0, 145))
    shadow_layer.putalpha(shadow.point(lambda a: int(a * .62)))
    frame.alpha_composite(shadow_layer, (position[0] + 8, position[1] + 32))
    frame.alpha_composite(board, position)


def render_pressure_interlude(frame: Image.Image, t: float) -> None:
    """One endangered white stone, enclosed by a precise geometric net."""
    local = (t - INTERLUDE_START) / (INTERLUDE_END - INTERLUDE_START)
    local = clamp(local)
    center = (W / 2, H * .52)
    entrance = smooth(0, .12, local)
    scale = 2.72 + .10 * smooth(0, 1, local)
    glow_blob(frame, center, 176 - 20 * local, BLUE, int(126 * entrance))
    glow_blob(frame, center, 94, VIOLET, int(86 * entrance))

    stone = WHITE_STONE.resize((int(90 * scale), int(90 * scale)), Image.Resampling.LANCZOS)
    stone.putalpha(stone.getchannel("A").point(lambda a: int(a * entrance)))
    frame.alpha_composite(stone, (int(center[0] - stone.width / 2), int(center[1] - stone.height / 2)))

    geometry = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(geometry)
    # Four sides close on successive half-bars, making the loss of liberties legible.
    stages = [smooth(.10 + i * .18, .25 + i * .18, local) for i in range(4)]
    outer = 235
    inner = 132
    segments = (
        ((center[0] - outer, center[1] - inner), (center[0] + outer, center[1] - inner)),
        ((center[0] + inner, center[1] - outer), (center[0] + inner, center[1] + outer)),
        ((center[0] + outer, center[1] + inner), (center[0] - outer, center[1] + inner)),
        ((center[0] - inner, center[1] + outer), (center[0] - inner, center[1] - outer)),
    )
    for index, (start, end) in enumerate(segments):
        progress = stages[index]
        finish = (start[0] + (end[0] - start[0]) * progress, start[1] + (end[1] - start[1]) * progress)
        draw.line((start, finish), fill=(*RED, int(215 * entrance)), width=7)
        node_x, node_y = finish
        draw.ellipse((node_x - 8, node_y - 8, node_x + 8, node_y + 8), fill=(*RED, int(240 * progress)))
    radius = 240 - 100 * smooth(.15, .92, local)
    draw.ellipse((center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius), outline=(*VIOLET, int(170 * entrance)), width=4)
    frame.alpha_composite(geometry.filter(ImageFilter.GaussianBlur(16)))
    frame.alpha_composite(geometry)

    # Controlled dust only; no morph, orbit, or AI-like object transformation.
    rng = random.Random(2029)
    dust = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    dd = ImageDraw.Draw(dust)
    for index in range(46):
        angle = rng.random() * math.tau
        distance = 115 + rng.random() * 230
        x = center[0] + math.cos(angle) * distance
        y = center[1] + math.sin(angle) * distance * .72
        radius = 1 + rng.random() * 3
        dd.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(*(BLUE if index % 3 else RED), 120))
    frame.alpha_composite(dust.filter(ImageFilter.GaussianBlur(1.2)))


def add_build_rays(frame: Image.Image, t: float) -> None:
    if not BUILD_START < t < FINAL_CAPTURE + .5:
        return
    strength = smooth(BUILD_START, FINAL_CAPTURE, t)
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    vanishing = (W * .46, H * .58)
    for index in range(12):
        angle = -1.0 + index * .18
        length = 700
        end = (vanishing[0] + math.cos(angle) * length, vanishing[1] + math.sin(angle) * length)
        draw.line((vanishing, end), fill=(*RED, int(18 * strength)), width=4)
    frame.alpha_composite(layer.filter(ImageFilter.GaussianBlur(10)))


def flash(frame: Image.Image, t: float) -> None:
    strength = max(
        pulse(t, INTERLUDE_START, .10),
        pulse(t, INTERLUDE_END, .10),
        pulse(t, FINAL_CAPTURE, .12),
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
    white.putalpha(white.getchannel("A").point(lambda a: int(a * progress)))
    black.putalpha(black.getchannel("A").point(lambda a: int(a * progress)))
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
    if INTERLUDE_START <= t < INTERLUDE_END:
        frame = background(t, VIOLET)
        render_pressure_interlude(frame, t)
    elif t < END_CARD_START:
        build = smooth(BUILD_START, FINAL_CAPTURE, t)
        accent = tuple(int(BLUE[c] * (1 - build) + RED[c] * build) for c in range(3))
        frame = background(t, accent)
        composite_board(frame, render_ladder_board(t), t)
        add_build_rays(frame, t)
    else:
        frame = background(t, (170, 175, 190))
    flash(frame, t)
    if t >= END_CARD_START - .05:
        frame = end_card(frame, t)
    add_film(frame, index)
    return frame.convert("RGB")


def synth_audio(path: Path) -> None:
    """Original 154 BPM tension cue; beat grid matches every visual impact."""
    rate = 48_000
    total = int(DURATION * rate)
    time = np.arange(total, dtype=np.float64) / rate
    rng = np.random.default_rng(4051)
    audio = np.zeros(total, dtype=np.float64)

    # Rising sub drone creates a continuous dramatic arc.
    frequency = 39 + 16 * np.clip(time / FINAL_CAPTURE, 0, 1) ** 1.6
    phase = 2 * np.pi * np.cumsum(frequency) / rate
    drone_gain = .055 + .055 * np.clip(time / FINAL_CAPTURE, 0, 1)
    audio += np.sin(phase) * drone_gain
    audio += np.sin(phase * 2.005 + .4) * drone_gain * .32

    noise = rng.normal(0, 1, total)
    atmosphere = np.convolve(noise, np.ones(260) / 260, mode="same")
    audio += atmosphere * (.025 + .035 * np.clip(time / FINAL_CAPTURE, 0, 1))

    def mix(at: float, sound: np.ndarray) -> None:
        start = max(0, int(at * rate))
        end = min(total, start + len(sound))
        if end > start:
            audio[start:end] += sound[: end - start]

    def kick(at: float, gain: float) -> None:
        local = np.arange(int(.55 * rate)) / rate
        sweep = 92 * np.exp(-local * 20) + 43
        phase_local = 2 * np.pi * np.cumsum(sweep) / rate
        sound = np.sin(phase_local) * np.exp(-local * 9.5) * gain
        click = rng.normal(0, 1, len(local)) * np.exp(-local * 55) * .08 * gain
        mix(at, sound + click)

    def stone_hit(at: float, color: str, gain: float = 1) -> None:
        local = np.arange(int(.48 * rate)) / rate
        base = 188 if color == "white" else 122
        tone = np.sin(2 * np.pi * base * local) * np.exp(-local * 15)
        tone += .42 * np.sin(2 * np.pi * base * 2.07 * local) * np.exp(-local * 19)
        crack = rng.normal(0, 1, len(local)) * np.exp(-local * 42)
        mix(at, (tone * .16 + crack * .055) * gain)

    def hat(at: float, gain: float) -> None:
        local = np.arange(int(.12 * rate)) / rate
        raw = rng.normal(0, 1, len(local))
        bright = np.concatenate(([0], np.diff(raw)))
        mix(at, bright * np.exp(-local * 42) * .028 * gain)

    def clap(at: float, gain: float) -> None:
        local = np.arange(int(.22 * rate)) / rate
        raw = rng.normal(0, 1, len(local))
        bright = np.concatenate(([0], np.diff(raw)))
        envelope = np.exp(-local * 24)
        # Three tiny bursts give a tight, edited transient instead of generic noise.
        envelope += .42 * np.exp(-np.maximum(0, local - .028) * 34) * (local >= .028)
        envelope += .24 * np.exp(-np.maximum(0, local - .052) * 42) * (local >= .052)
        mix(at, bright * envelope * .018 * gain)

    def riser(start: float, end: float, gain: float) -> None:
        length = int((end - start) * rate)
        local = np.arange(length) / rate
        progress = local / max(1e-6, end - start)
        raw = rng.normal(0, 1, length)
        bright = np.concatenate(([0], np.diff(raw)))
        sound = bright * (progress ** 1.9) * .018 * gain
        frequency_local = 180 + 620 * progress ** 2
        phase_local = 2 * np.pi * np.cumsum(frequency_local) / rate
        sound += np.sin(phase_local) * (progress ** 2) * .035 * gain
        mix(start, sound)

    def impact(at: float, gain: float) -> None:
        local = np.arange(int(2.0 * rate)) / rate
        sub = np.sin(2 * np.pi * 47 * local) * np.exp(-local * 3.5)
        metal = np.sin(2 * np.pi * 191 * local) * np.exp(-local * 8)
        burst = rng.normal(0, 1, len(local)) * np.exp(-local * 18)
        mix(at, (sub * .24 + metal * .07 + burst * .08) * gain)

    # Sparse opening, then increasingly dense percussion on the same reference-like grid.
    beat_count = int(DURATION / BEAT) + 1
    for beat_index in range(beat_count):
        at = beat_index * BEAT
        if at < MOVE_TIMES[0]:
            if beat_index % 4 == 0:
                kick(at, .50)
        elif at < INTERLUDE_START:
            if beat_index % 2 == 0:
                kick(at, .70)
            hat(at, .68)
            if beat_index % 2 == 1:
                clap(at, .42)
        elif at < INTERLUDE_END:
            if beat_index % 2 == 0:
                kick(at, .55)
        elif at < BUILD_START:
            if beat_index % 2 == 0:
                kick(at, .78)
            hat(at, .88)
            if beat_index % 2 == 1:
                clap(at, .62)
        elif at < FINAL_CAPTURE:
            kick(at, .82 if beat_index % 2 == 0 else .48)
            hat(at, 1.12)
            clap(at, .76)
            hat(at + BEAT / 2, .56)

    for index, ((color, _), at) in enumerate(zip(LADDER_MOVES, MOVE_TIMES)):
        stone_hit(at, color, .90 + .025 * index)

    riser(INTERLUDE_START, INTERLUDE_END, .68)
    riser(BUILD_START, FINAL_CAPTURE, 1.40)
    impact(FINAL_CAPTURE, 2.25)
    # Final brand reveal resolves the tension with one clean, bright strike.
    stone_hit(END_CARD_START, "white", 1.15)
    local = np.arange(int(1.8 * rate)) / rate
    chime = (np.sin(2 * np.pi * 392 * local) + .55 * np.sin(2 * np.pi * 588 * local)) * np.exp(-local * 2.6) * .07
    mix(END_CARD_START, chime)

    # Brief post-capture duck makes the climax breathe before the logo.
    duck = 1 - .58 * np.exp(-((time - (FINAL_CAPTURE + .20)) / .48) ** 2)
    audio *= duck
    fade = np.clip(time / .45, 0, 1) * np.clip((DURATION - time) / .65, 0, 1)
    audio *= fade
    audio = np.tanh(audio * 3.0)
    peak = max(1e-9, float(np.max(np.abs(audio))))
    audio = audio / peak * .89
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
    with tempfile.TemporaryDirectory(prefix="gostone-ladder-") as temp_name:
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
