#!/usr/bin/env python3
"""Refresh the GitHub Pages configurator's skin assets from the repository."""

from pathlib import Path
import argparse
import hashlib
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'docs' / 'assets'
SOURCES = [ROOT / 'skin' / name for name in ('Pro.xml', 'gfx-pro.png', 'icons_daylight.png')]
SOURCES.append(ROOT / 'themes.json')


def versioned_web_files():
    """Version each module dependency so cached files cannot mix old and new UI."""
    docs = ROOT / 'docs'
    imports = re.compile(r"(\bfrom\s+['\"])(\./[\w-]+\.js)(?:\?v=[a-f0-9]+)?(['\"])")
    references = re.compile(r'((?:src|href)=")([\w-]+\.(?:js|css))(?:\?v=[a-f0-9]+)?(")')
    updated = {}
    visiting = set()

    def digest(text):
        return hashlib.sha256(text.encode()).hexdigest()[:12]

    def module(path):
        if path in updated:
            return updated[path]
        if path in visiting:
            raise ValueError(f'Circular module imports: {path.name}')
        visiting.add(path)

        def replace(match):
            target = path.parent / match[2][2:]
            return f'{match[1]}{match[2]}?v={digest(module(target))}{match[3]}'

        updated[path] = imports.sub(replace, path.read_text())
        visiting.remove(path)
        return updated[path]

    for path in sorted(docs.glob('*.js')):
        module(path)

    def reference(match):
        path = docs / match[2]
        content = updated[path] if path in updated else path.read_text()
        return f'{match[1]}{match[2]}?v={digest(content)}{match[3]}'

    index = docs / 'index.html'
    updated[index] = references.sub(reference, index.read_text())
    return updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if published assets need refreshing.')
    args = parser.parse_args()
    web_files = versioned_web_files()
    if args.check:
        stale = [source.name for source in SOURCES
                 if not (ASSETS / source.name).exists()
                 or source.read_bytes() != (ASSETS / source.name).read_bytes()]
        stale.extend(str(path.relative_to(ROOT)) for path, content in web_files.items()
                     if path.read_text() != content)
        if stale:
            raise SystemExit('Refresh configurator assets: ' + ', '.join(stale))
        print('Configurator assets match the skin source.')
        return
    ASSETS.mkdir(parents=True, exist_ok=True)
    for source in SOURCES:
        shutil.copyfile(source, ASSETS / source.name)
    for path, content in web_files.items():
        if path.read_text() != content:
            path.write_text(content)
    (ROOT / 'docs' / '.nojekyll').touch()
    print('Refreshed configurator assets.')


if __name__ == '__main__':
    main()
