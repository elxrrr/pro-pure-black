#!/usr/bin/env python3
"""Regenerate the deck palettes and menus in the single Pro OLED XML."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'skin/Pro.xml'
BEGIN = '\t\t<!-- BEGIN OLED DECK THEMES -->'
END = '\t\t<!-- END OLED DECK THEMES -->'
ATOMIX_DEFAULT = ('#156C89', '#AC2F37', '#0D7264', '#A54D30')


def validate_themes(themes):
    """Default is Atomix's palette and must never be customised."""
    if not themes or themes[0] != {
        'id': 0, 'name': 'Default', 'slug': 'default', 'colors': list(ATOMIX_DEFAULT)
    }:
        raise ValueError('Default must retain the original Atomix palette unchanged.')
    if [theme['id'] for theme in themes] != list(range(len(themes))):
        raise ValueError('Theme IDs must be unique and sequential, starting at Default=0.')
    for theme in themes:
        if len(theme['colors']) != 4 or not all(
            re.fullmatch(r'#[0-9A-Fa-f]{6}', value) for value in theme['colors']
        ):
            raise ValueError(f'Expected four hex colours for {theme["name"]}.')


def mix(value, amount, target=0):
    rgb = [int(value[i:i+2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(c * (1-amount) + target * amount):02X}' for c in rgb)


def group_bounds(text, name):
    match = re.search(r'<group\b[^>]*name="' + re.escape(name) + r'"[^>]*>', text)
    if not match:
        return None
    depth = 0
    for token in re.finditer(r'<(/?)group\b[^>]*>', text[match.start():]):
        depth += -1 if token[1] else 1
        if depth == 0:
            return match.start(), match.start() + token.end()
    raise ValueError(f'Unclosed group: {name}')


def definition(name, value, deck=None, indent='\t\t\t'):
    scope = f' deck="{deck}"' if deck is not None else ''
    return f'{indent}<define color="{name}" value="{value}"{scope}/>'


def theme_waveforms(text, themes):
    """Give Shapes theme shades while leaving Default's native colours unset."""
    # Recover the original elements before rebuilding, so this stays idempotent.
    generated = re.compile(
        r'^(?P<indent>[ \t]*)<!-- BEGIN OLED WAVEFORM -->\n'
        r'[ \t]*<group condition="[^"]+">\n(?P<original>.*?)\n'
        r'(?P=indent)</group>\n.*?'
        r'(?P=indent)<!-- END OLED WAVEFORM -->', re.M | re.S)
    text = generated.sub(
        lambda match: '\n'.join(line[1:] for line in match['original'].split('\n')),
        text)
    native = ''.join(f"var_equal '@$oleddecktheme' {t['id']} ? false : "
                     for t in themes[1:]) + 'true'
    themed = ''.join(f"var_equal '@$oleddecktheme' {t['id']} ? true : "
                     for t in themes[1:]) + 'false'
    colours = (' colorVocal="oled_wavevocal" colorInstru="oled_waveinstru"'
               ' colorBeat="oled_wavebeat"')

    def variants(match):
        indent, original = match['indent'], match[0]
        custom = original.replace('>', colours + '>', 1)
        def nested(element):
            return '\n'.join('\t' + re.sub(r'^[ \t]+',
                lambda prefix: prefix[0].replace(' ', ''), line.rstrip())
                for line in element.split('\n'))
        return (f'{indent}<!-- BEGIN OLED WAVEFORM -->\n'
                f'{indent}<group condition="{native}">\n{nested(original)}\n'
                f'{indent}</group>\n'
                f'{indent}<group condition="{themed}">\n{nested(custom)}\n'
                f'{indent}</group>\n{indent}<!-- END OLED WAVEFORM -->')

    text, count = re.subn(
        r'^(?P<indent>[ \t]*)<(?P<tag>scratchwave|songpos)\b[^>]*>.*?</(?P=tag)>',
        variants, text, flags=re.M | re.S)
    assert count == 16, f'Expected 12 scratch waves and 4 deck overviews, got {count}'
    return text


def build():
    text = PATH.read_bytes().decode().replace('\r\n', '\n')
    themes = json.loads((ROOT / 'themes.json').read_text())
    validate_themes(themes)

    # Remove the stock surface variants; an old saved scheme cannot leak through.
    for name in ('colorscheme-contrast', 'colorscheme-darkmode', 'colorscheme-lightmode'):
        bounds = group_bounds(text, name)
        if bounds:
            text = text[:bounds[0]] + text[bounds[1]:]
    if BEGIN in text:
        start = text.index(BEGIN)
        end = text.index(END, start) + len(END)
        text = text[:start] + text[end:]
    text = re.sub(r'^.*<background\b[^>]*condition="var_equal \'@\$oledcolorscheme\' [123]"[^>]*/>\n', '', text, flags=re.M)
    text = re.sub(r'^.*<customicons\b[^>]*condition="var_equal \'@\$oledcolorscheme\' 2"[^>]*/>\n', '', text, flags=re.M)
    # Daylight sprite alternatives and dialog appearance are no longer needed.
    text = re.sub(r'^.*<(?:off|dialogs)\b[^>]*condition="var_equal \'@\$oledcolorscheme\' 2"[^>]*/>\n', '', text, flags=re.M)
    text = text.replace(' condition="var_not_equal \'@$oledcolorscheme\' 2"', '')
    text = text.replace(' condition="var_equal \'@$oledcolorscheme\' 0"', '')
    # Remove obsolete fallbacks now that the OLED values are unconditional.
    text = re.sub(r'^\s*<define color="oled_[^"]+" value="(?!#)[^"]+"/>\n', '\n', text, flags=re.M)

    plugin_defaults = {
        'oled_plugin_over1': '#1C7B97', 'oled_plugin_selected1': '#136C8A',
        'oled_plugin_down1': '#0B485D', 'oled_plugin_over2': '#B73B42',
        'oled_plugin_selected2': '#AD3237', 'oled_plugin_down2': '#821A1F',
        'oled_plugin_slider1': '#136C8A', 'oled_plugin_disabled1': '#0A3F50',
        'oled_plugin_slider2': '#AD3237', 'oled_plugin_disabled2': '#761318',
    }
    attrs = {'over_deck': 'over', 'selected_deck': 'selected', 'down_deck': 'down'}
    for prefix, role in attrs.items():
        for deck in (1, 2):
            text = re.sub(fr'{prefix}{deck}="#[0-9a-fA-F]+"', f'{prefix}{deck}="oled_plugin_{role}{deck}"', text)
    for deck in (1, 2):
        text = re.sub(fr'\bdeck{deck}="#[0-9a-fA-F]+"', f'deck{deck}="oled_plugin_slider{deck}"', text)
        text = re.sub(fr'\bdeck{deck}_disabled="#[0-9a-fA-F]+"', f'deck{deck}_disabled="oled_plugin_disabled{deck}"', text)

    # Text-bearing filled controls use darker shades; indicator rings stay bright.
    def fill_alias(match):
        tag = match[0]
        if tag.startswith('<on ') and 'shape="circle"' in tag:
            return tag
        return tag.replace('color="buttonon"', 'color="oled_buttonfill"')
    text = re.sub(r'<(?:selected|down|on)\b[^>]*\bcolor="buttonon"[^>]*/>', fill_alias, text)
    text = text.replace('<selected color="deckcolordark"', '<selected color="oled_deck_selected"')

    lines = [BEGIN]
    for name, value in plugin_defaults.items():
        lines.append(definition(name, value, indent='\t\t'))
    originals = themes[0]['colors']
    darks = ['#0D5269', '#8E1E25', '#0B544A', '#84341A']
    for deck, base, dark in zip(range(1, 5), originals, darks):
        lines.append(definition('oled_buttonfill', base, deck, '\t\t'))
        lines.append(definition('oled_deck_selected', dark, deck, '\t\t'))
    lines += [definition('oled_buttonfill', '#B03239', 'right', '\t\t'),
              definition('oled_buttonfill', '#4F5076', 'master', '\t\t')]
    for theme in themes[1:]:
        lines.append(f'\t\t<group name="oled-theme-{theme["slug"]}" condition="var_equal \'@$oleddecktheme\' {theme["id"]}">')
        for deck, base in enumerate(theme['colors'], 1):
            bright, dark = mix(base, .12, 255), mix(base, .32)
            roles = {
                'deckcolor': base, 'deckcolorbright': bright, 'deckcolordark': dark,
                'deckcolor_invert': bright, 'padbuttonselected': mix(base, .82),
                'buttonon': base, 'buttonover': mix(base, .76),
                'buttonselected': mix(base, .82), 'oled_buttonfill': mix(base, .66),
                'oled_deck_selected': mix(base, .66), 'textdeck': bright,
                'faderinon': base, 'knobfillon': base, 'colorbass': mix(base, .66),
                'colormed': dark, 'colorhigh': base, 'scratch1': base, 'scratch2': base,
                'oled_wavevocal': dark, 'oled_waveinstru': base,
                'oled_wavebeat': mix(base, .35, 255),
            }
            for name, value in roles.items():
                lines.append(definition(name, value, deck))
            lines.append(definition(f'waveform_active{deck}', base))
            lines.append(definition(f'waveform_passive{deck}', dark))
        for side, index in (('left', 0), ('right', 1)):
            base = theme['colors'][index]
            for name in ('deckcolor', 'faderinon', 'knobfillon'):
                lines.append(definition(name, base, side))
            if side == 'right':
                lines.append(definition('buttonon', base, side))
                lines.append(definition('oled_buttonfill', mix(base, .66), side))
            lines.append(definition(f'faderin{side}', base))
        for deck in (1, 2):
            base = theme['colors'][deck-1]
            for role, value in {'over': mix(base, .76), 'selected': mix(base, .66),
                                'down': mix(base, .72), 'slider': base,
                                'disabled': mix(base, .66)}.items():
                lines.append(definition(f'oled_plugin_{role}{deck}', value))
        lines.append('\t\t</group>')
    lines.append(END)
    marker = '\t\t<!--  dialogs & tooltips -->'
    assert text.count(marker) == 1
    text = text.replace(marker, '\n'.join(lines) + '\n\n' + marker)

    menu = '<submenu text="Deck Colours" localize="false">\n'
    for theme in themes:
        menu += f'\t\t\t\t\t\t<item text="{theme["name"]}" localize="false" action="set \'@$oleddecktheme\' {theme["id"]} & load_skin" check="var_equal \'@$oleddecktheme\' {theme["id"]}"/>\n'
    menu += '\t\t\t\t\t</submenu>'
    text, count = re.subn(r'<submenu text="(?:Color Scheme|Deck Colours)"[^>]*>.*?</submenu>', lambda _: menu, text, flags=re.S)
    assert count == 2
    assert '@$oledcolorscheme' not in text
    text = theme_waveforms(text, themes)
    text = re.sub(r'\n[ \t]*\n(?:[ \t]*\n)+', '\n\n', text)
    text = re.sub(r'(^[ \t]*(?:over|selected|down)_deck[12]="oled_plugin_[^"]+")[ \t]+$', r'\1', text, flags=re.M)
    PATH.write_bytes(text.replace('\n', '\r\n').encode())
    print(f'Built {len(themes)} deck colour choices in {PATH.name}')


if __name__ == '__main__':
    build()
