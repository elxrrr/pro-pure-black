# Development

The GitHub Pages configurator is served from `docs/`. It generates skin ZIPs in the browser using the bundled skin and sprite assets.

After changing `skin/` or `themes.json`, refresh the assets:

```sh
python3 tools/build_configurator.py
python3 tools/build_configurator.py --check
node tools/test_configurator.mjs
```

Preview locally:

```sh
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000`. Push `main` to publish the updated site.
