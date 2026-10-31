"""Draws OpenDuet's icons: the ThreatVector reticle (four corner brackets around a square) in signal red.

Run: python3 scripts/icons.py   (needs Pillow). Writes build/ (desktop) and assets/ (Android, for @capacitor/assets).
"""
from pathlib import Path

from PIL import Image, ImageDraw

RED = (224, 0, 0, 255)
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)
CLEAR = (0, 0, 0, 0)
ROOT = Path(__file__).resolve().parent.parent


def reticle(draw: ImageDraw.ImageDraw, box: tuple[float, float, float, float], color, stroke: float, arm: float, dot: float):
    """Corner brackets inside `box`, plus a solid square in the middle."""
    x0, y0, x1, y1 = box
    for cx, cy, dx, dy in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        draw.rectangle(sorted_box(cx, cy, cx + dx * arm, cy + dy * stroke), fill=color)
        draw.rectangle(sorted_box(cx, cy, cx + dx * stroke, cy + dy * arm), fill=color)
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    draw.rectangle((mx - dot / 2, my - dot / 2, mx + dot / 2, my + dot / 2), fill=color)


def sorted_box(ax, ay, bx, by):
    return (min(ax, bx), min(ay, by), max(ax, bx) - 1, max(ay, by) - 1)


def mark(size: int, bg, fg, inset: float, radius: float = 0, scale: int = 4) -> Image.Image:
    """The mark on a square tile. Drawn 4x larger and downsampled for clean edges."""
    s = size * scale
    img = Image.new('RGBA', (s, s), CLEAR)
    d = ImageDraw.Draw(img)
    if bg is not None:
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=radius * scale, fill=bg)
    i = inset * s
    span = s - 2 * i
    reticle(d, (i, i, s - i, s - i), fg, stroke=span * 0.085, arm=span * 0.3, dot=span * 0.2)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def save(img: Image.Image, rel: str):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print('wrote', rel, img.size)


# macOS app icon: 824px rounded tile centred on a 1024 canvas (Apple's icon grid).
canvas = Image.new('RGBA', (1024, 1024), CLEAR)
canvas.alpha_composite(mark(824, RED, WHITE, inset=0.25, radius=185), (100, 100))
save(canvas, 'build/icon.png')

# Menu-bar icon: a black template image; macOS tints it for light and dark menu bars.
save(mark(16, None, BLACK, inset=0.06), 'build/trayTemplate.png')
save(mark(32, None, BLACK, inset=0.06), 'build/trayTemplate@2x.png')

# Android, consumed by `npx @capacitor/assets generate --android`.
save(mark(1024, RED, WHITE, inset=0.28), 'assets/icon-only.png')
save(mark(1024, None, WHITE, inset=0.36), 'assets/icon-foreground.png')  # inside the adaptive-icon safe zone
save(Image.new('RGBA', (1024, 1024), RED), 'assets/icon-background.png')
splash = Image.new('RGBA', (2732, 2732), WHITE)
splash.alpha_composite(mark(560, None, RED, inset=0.0), (1086, 1086))
save(splash, 'assets/splash.png')
