#!/usr/bin/env python3
"""Refresh the GitHub Pages configurator's skin assets from the repository."""

from pathlib import Path
import argparse
import shutil

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'docs' / 'assets'
SOURCES = [ROOT / 'skin' / name for name in ('Pro.xml', 'gfx-pro.png', 'icons_daylight.png')]
SOURCES.append(ROOT / 'themes.json')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if published assets need refreshing.')
    args = parser.parse_args()
    if args.check:
        stale = [source.name for source in SOURCES
                 if not (ASSETS / source.name).exists()
                 or source.read_bytes() != (ASSETS / source.name).read_bytes()]
        if stale:
            raise SystemExit('Refresh configurator assets: ' + ', '.join(stale))
        print('Configurator assets match the skin source.')
        return
    ASSETS.mkdir(parents=True, exist_ok=True)
    for source in SOURCES:
        shutil.copyfile(source, ASSETS / source.name)
    (ROOT / 'docs' / '.nojekyll').touch()
    print('Refreshed configurator assets.')


if __name__ == '__main__':
    main()
