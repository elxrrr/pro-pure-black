import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CUSTOM_START_COLORS, randomPalette, relatedPalette } from '../docs/custom-palettes.js';

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const rgb = hex => hex.slice(1).match(/../g).map(part => parseInt(part, 16));
const distance = (a, b) => Math.hypot(...rgb(a).map((channel, index) => channel - rgb(b)[index]));

test('new custom presets always have the same protected starting quartet', () => {
  assert.deepEqual(CUSTOM_START_COLORS, ['#E98DB6', '#89BFF0', '#B69BE4', '#F2C48F']);
  assert.equal(Object.isFrozen(CUSTOM_START_COLORS), true);
  const editableCopy = [...CUSTOM_START_COLORS];
  editableCopy[0] = '#000000';
  assert.equal(CUSTOM_START_COLORS[0], '#E98DB6');
});

test('related palettes preserve deck A and are reproducible with an injected random source', () => {
  assert.deepEqual(relatedPalette(' #e98db6 ', seeded(42)), relatedPalette('#E98DB6', seeded(42)));
  assert.equal(relatedPalette('#001aFf', seeded(42))[0], '#001AFF');
  const samples = new Set(Array.from({length: 12}, (_, index) => relatedPalette('#E98DB6', seeded(index + 1)).join(',')));
  assert.ok(samples.size >= 10, 'Repeated requests must offer useful variety');
});

test('Random chooses a new pastel A and derives its other three colours', () => {
  assert.deepEqual(randomPalette(seeded(42)), randomPalette(seeded(42)));
  const random = seeded(12345);
  const anchors = new Set();
  for (let sample = 0; sample < 100; sample++) {
    const palette = randomPalette(random);
    assert.equal(palette.length, 4);
    assert.equal(new Set(palette).size, 4);
    for (const colour of palette) assert.match(colour, /^#[A-F0-9]{6}$/);
    assert.notDeepEqual(palette, CUSTOM_START_COLORS);
    anchors.add(palette[0]);
    const channels = rgb(palette[0]).map(value => value / 255);
    const lightness = (Math.max(...channels) + Math.min(...channels)) / 2;
    assert.ok(lightness >= .595 && lightness <= .725, 'Random A stays in the pastel range');
  }
  assert.ok(anchors.size >= 95, 'Random changes A instead of reusing the initial colour');

  // A deterministic stream shows that the remaining colours are derived from
  // the newly picked A using the remaining draws, rather than unrelated RGB.
  const draws = [.20, .35, .60, .75, .1, .2, .3, .4, .5, .6, .7, .8, .9];
  const palette = randomPalette(() => draws.shift());
  const companionDraws = [.75, .1, .2, .3, .4, .5, .6, .7, .8, .9];
  assert.deepEqual(palette, relatedPalette(palette[0], () => companionDraws.shift()));
});

test('coloured and neutral anchors produce distinct pastel companions across bounded samples', () => {
  const anchors = ['#000000', '#FFFFFF', '#808080', '#010101', '#FEFEFE', '#827E80',
    '#FF0000', '#00FF00', '#0000FF', '#E98DB6', '#156C89', '#F2C48F'];
  for (const anchor of anchors) {
    for (let seed = 0; seed < 100; seed++) {
      const palette = relatedPalette(anchor, seeded(seed));
      assert.equal(palette[0], anchor);
      assert.equal(palette.length, 4);
      assert.equal(new Set(palette).size, 4, `${anchor}: duplicate swatches`);
      for (const colour of palette.slice(1)) {
        assert.match(colour, /^#[A-F0-9]{6}$/);
        const channels = rgb(colour).map(value => value / 255);
        const high = Math.max(...channels), low = Math.min(...channels);
        const lightness = (high + low) / 2;
        const saturation = (high - low) / (1 - Math.abs(2 * lightness - 1));
        assert.ok(lightness >= .625 && lightness <= .835, `${colour}: pastel lightness`);
        assert.ok(saturation >= .38 && saturation <= .77, `${colour}: restrained saturation`);
      }
      for (let i = 1; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          assert.ok(distance(palette[i], palette[j]) > 25, `${anchor}: companions too similar`);
        }
      }
    }
  }
});

test('extreme random values are handled without retries or duplicate swatches', () => {
  for (const anchor of ['#000000', '#FFFFFF', '#E98DB6']) {
    for (const value of [0, 1 - Number.EPSILON]) {
      let draws = 0;
      const palette = relatedPalette(anchor, () => { draws++; return value; });
      assert.ok(draws <= 11);
      assert.equal(new Set(palette).size, 4);
      assert.equal(palette[0], anchor);
    }
  }
  for (const value of [0, 1 - Number.EPSILON]) {
    let draws = 0;
    const palette = randomPalette(() => { draws++; return value; });
    assert.equal(draws, 13);
    assert.equal(new Set(palette).size, 4);
  }
});

test('invalid colours and random sources fail clearly', () => {
  for (const bad of [null, undefined, 123, '', '#FFF', 'E98DB6', '#GG0000', '#1234567']) {
    assert.throws(() => relatedPalette(bad), /six-digit hex colour/);
  }
  assert.throws(() => relatedPalette('#FFFFFF', 0), /Random must be a function/);
  assert.throws(() => randomPalette(0), /Random must be a function/);
  for (const bad of [-1, 1, NaN, Infinity, '0.5']) {
    assert.throws(() => relatedPalette('#FFFFFF', () => bad), /Random must return a number/);
    assert.throws(() => randomPalette(() => bad), /Random must return a number/);
  }
});
