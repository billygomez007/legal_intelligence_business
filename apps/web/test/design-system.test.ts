import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { themeColor } from '../src/design/tokens';

const srcDir = join(import.meta.dirname, '..', 'src');
const tokensCss = readFileSync(join(srcDir, 'styles', 'tokens.css'), 'utf8');

/** Custom properties declared in tokens.css, e.g. `--bg` → `#06101d`. */
const tokens = new Map<string, string>();
for (const [, name, value] of tokensCss.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
  if (name && value) tokens.set(name, value.trim());
}

function hex(name: string): string {
  const value = tokens.get(name);
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a #rrggbb token`);
  return value;
}

function channels(color: string): [number, number, number] {
  const n = Number.parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(color: string): number {
  const [r, g, b] = channels(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('LexGhana design tokens', () => {
  it('defines every token the design system promises', () => {
    const required = [
      // backgrounds and surfaces
      '--bg',
      '--bg-elevated',
      '--surface',
      '--surface-strong',
      '--surface-hover',
      // borders
      '--border',
      '--border-subtle',
      // text
      '--fg',
      '--fg-secondary',
      '--fg-muted',
      // gold
      '--gold',
      '--gold-hover',
      '--gold-muted',
      // status
      '--success',
      '--warning',
      '--info',
      '--danger',
      // geometry
      '--sidebar-width',
      '--content-max',
      '--radius-card',
      '--radius-control',
      // elevation and spacing rhythm
      '--shadow-card',
      '--shadow-raised',
      '--space-1',
      '--space-4',
      '--space-8',
      // typography
      '--font-ui',
      '--font-display',
    ];
    expect(required.filter((name) => !tokens.has(name))).toEqual([]);
  });

  it('is unmistakably deep navy with Ghana gold', () => {
    for (const name of ['--bg', '--bg-elevated', '--surface', '--surface-strong']) {
      const [r, g, b] = channels(hex(name));
      expect(luminance(hex(name)), `${name} must be very dark`).toBeLessThan(0.03);
      expect(b, `${name} must lean blue`).toBeGreaterThan(r);
      expect(b, `${name} must lean blue`).toBeGreaterThanOrEqual(g);
    }
    const [r, g, b] = channels(hex('--gold'));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r).toBeGreaterThan(190);
    expect(b).toBeLessThan(80);
  });

  it('gives each evidence layer its own colour so layers cannot be blurred together', () => {
    const layers = ['--layer-source', '--layer-synthesis', '--layer-metadata', '--layer-note'];
    for (const name of layers) expect(tokens.has(name), name).toBe(true);
    const resolved = layers.map((name) => {
      const value = tokens.get(name) ?? '';
      const alias = /^var\((--[\w-]+)\)$/.exec(value);
      return alias?.[1] ? (tokens.get(alias[1]) ?? value) : value;
    });
    expect(new Set(resolved).size).toBe(layers.length);
  });

  it('keeps the browser theme colour equal to the page background token', () => {
    expect(themeColor).toBe(hex('--bg'));
  });

  it('meets WCAG AA (4.5:1) for text on every surface it is used on', () => {
    const surfaces = ['--bg', '--bg-elevated', '--surface', '--surface-strong', '--surface-hover'];
    const textOnSurfaces = [
      '--fg',
      '--fg-secondary',
      '--fg-muted',
      '--gold',
      '--gold-hover',
      '--success',
      '--warning',
      '--info',
      '--danger',
      '--layer-metadata',
      '--layer-note',
    ];
    const failures: string[] = [];
    for (const text of textOnSurfaces)
      for (const surface of surfaces) {
        const ratio = contrast(hex(text), hex(surface));
        if (ratio < 4.5) failures.push(`${text} on ${surface} = ${ratio.toFixed(2)}`);
      }
    // Dark text on the gold button.
    for (const gold of ['--gold', '--gold-hover']) {
      const ratio = contrast(hex('--fg-inverse'), hex(gold));
      if (ratio < 4.5) failures.push(`--fg-inverse on ${gold} = ${ratio.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('design-system discipline', () => {
  const files = (readdirSync(srcDir, { recursive: true }) as string[])
    .map((entry) => join(srcDir, entry))
    .filter((path) => /\.(css|tsx?)$/.test(path))
    .filter((path) => !path.split(sep).includes('.kilo'));
  const allowed = new Set([join('styles', 'tokens.css'), join('design', 'tokens.ts')]);
  const rawColour = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('keeps raw colour values out of components and stylesheets', () => {
    const offenders = files
      .filter((path) => !allowed.has(relative(srcDir, path)))
      .filter((path) => rawColour.test(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
      .map((path) => relative(srcDir, path));
    expect(offenders).toEqual([]);
  });
});
