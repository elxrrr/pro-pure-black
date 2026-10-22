#!/usr/bin/env python3
"""Render SVG palette previews using the skin's jogwheel_c geometry.

These are deterministic palette illustrations, not application screenshots.
Run from any directory; all colours come from the repository's themes.json.
"""

from __future__ import annotations

import json
import math
import sys
from html import escape
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from build_themes import validate_themes


ROOT = Path(__file__).resolve().parents[1]
WIDTH = 900
ROW_HEIGHT = 245
DEFAULT_DARK = ("#0D5269", "#8E1E25", "#0B544A", "#84341A")
DEFAULT_BRIGHT = ("#1E7B96", "#B73841", "#108473", "#B05B39")
GREY = "#B0B0B0"
RING = "#484848"


def shade(value: str, factor: float = 1, white: float = 0) -> str:
    """Match theme colour derivation in the skin builder."""
    rgb = [int(value[index:index + 2], 16) for index in (1, 3, 5)]
    return "#" + "".join(
        f"{round(channel * factor * (1 - white) + 255 * white):02X}"
        for channel in rgb
    )


def text(x: float, y: float, value: str, size: int, colour: str = GREY,
         anchor: str = "middle", weight: int = 400) -> str:
    return (
        f'<text x="{x:g}" y="{y:g}" fill="{colour}" '
        f'font-size="{size}" text-anchor="{anchor}" font-weight="{weight}">'
        f'{escape(value)}</text>'
    )


def jogwheel(colour: str, dark: str, bright: str, deck: str, x: int) -> str:
    """164px jog wheel: 2px border, 8px progress ring, 144px black centre."""
    parts = [f'<g transform="translate({x},50)">']
    parts.append(f'<circle cx="82" cy="82" r="81" fill="#000000" stroke="{RING}" stroke-width="2"/>')
    parts.append(f'<circle cx="82" cy="82" r="76" fill="none" stroke="{RING}" stroke-width="8"/>')
    parts.append(
        f'<circle cx="82" cy="82" r="76" fill="none" stroke="{colour}" '
        f'stroke-width="8" stroke-dasharray="{2*math.pi*76*.71:.4f} {2*math.pi*76*.29:.4f}" '
        'transform="rotate(-90 82 82)"/>'
    )
    parts.append('<circle cx="82" cy="82" r="71.5" fill="#000000" stroke="#000000"/>')
    parts.append(
        f'<rect x="79" y="13" width="6" height="57" fill="{dark}" '
        'transform="rotate(-60 82 82)"/>'
    )
    parts.append(f'<circle cx="82" cy="82" r="6" fill="{colour}"/>')
    parts.append(text(82, 61, "128.00", 30, bright, weight=700))
    parts.append(text(41, 85, "+0.0%", 14))
    parts.append(text(123, 85, "±8%", 14))
    parts.append(text(82, 115, "02:47.8", 18))
    parts.append(text(82, 136, "−03:13.5", 18))
    parts.append(text(82, 187, f"{deck}  ·  {colour}", 13))
    parts.append('</g>')
    return "\n".join(parts)


def theme_row(theme: dict, offset: int = 0, divider: bool = False) -> str:
    parts = [f'<g transform="translate(0,{offset})">']
    if divider:
        parts.append('<path d="M20 0H880" stroke="#252525"/>')
    parts.append(text(24, 28, theme["name"], 20, "#E6E6E6", "start", 600))
    parts.append(text(876, 27, "Palette preview", 11, "#808080", "end"))
    for index, (deck, colour) in enumerate(zip("ABCD", theme["colors"])):
        dark = DEFAULT_DARK[index] if theme["id"] == 0 else shade(colour, factor=.68)
        bright = DEFAULT_BRIGHT[index] if theme["id"] == 0 else shade(colour, white=.12)
        parts.append(jogwheel(colour, dark, bright, deck, 43 + index * 217))
    parts.append('</g>')
    return "\n".join(parts)


def document(title: str, height: int, content: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" '
        f'viewBox="0 0 {WIDTH} {height}" role="img" aria-labelledby="title desc">\n'
        f'<title id="title">{escape(title)}</title>\n'
        '<desc id="desc">Rendered palette preview based on the Pro Pure Black jog-wheel layout. '
        'Four decks, A through D, shown left to right. Backgrounds remain pure black. '
        'This is an illustration, not an application screenshot.</desc>\n'
        '<style>text{font-family:Arial,Helvetica,sans-serif;font-variant-numeric:tabular-nums}</style>\n'
        f'<rect width="{WIDTH}" height="{height}" fill="#000000"/>\n'
        f'{content}\n</svg>\n'
    )


def save(path: Path, contents: str) -> None:
    ET.fromstring(contents)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding="utf-8")
    if '--png' in sys.argv:
        import resvg_py
        path.with_suffix('.png').write_bytes(resvg_py.svg_to_bytes(
            svg_string=contents, font_family='Arial', sans_serif_family='Arial'))


def main() -> None:
    themes = json.loads((ROOT / "themes.json").read_text(encoding="utf-8"))
    validate_themes(themes)
    seen = set()
    for theme in themes:
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", theme["slug"]):
            raise ValueError(f"Invalid theme slug: {theme['slug']!r}")
        if theme["slug"] in seen:
            raise ValueError(f"Duplicate theme slug: {theme['slug']!r}")
        seen.add(theme["slug"])
        if len(theme["colors"]) != 4 or not all(
            re.fullmatch(r"#[0-9A-Fa-f]{6}", value) for value in theme["colors"]
        ):
            raise ValueError(f"Expected four hex deck colours for {theme['name']}")
        target = ROOT / "screenshots" / "themes" / f"{theme['slug']}.svg"
        save(target, document(f"Pro Pure Black — {theme['name']}", ROW_HEIGHT, theme_row(theme)))

    sheet = "\n".join(
        theme_row(theme, index * ROW_HEIGHT, divider=index > 0)
        for index, theme in enumerate(themes)
    )
    save(ROOT / "screenshots" / "theme-preview.svg",
         document("Pro Pure Black — all deck palettes", ROW_HEIGHT * len(themes), sheet))
    print(f"Rendered and XML-validated {len(themes)} palette previews and one combined sheet.")


if __name__ == "__main__":
    main()
