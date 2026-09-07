#!/usr/bin/env node
/**
 * Post-build assertions on the production bundle.
 *
 * These exist because the guarantees they check are otherwise only claims in a
 * markdown file. Run by `npm run verify:bundle`, and by CI after `npm run build`.
 *
 * Background (docs/living-spec.md D-006/D-007): kdbxweb carries Node-only
 * fallbacks for XML parsing and hashing, guarded behind `globalThis.DOMParser`
 * and `globalThis.crypto?.subtle`. In a browser those branches are dead code, but
 * a bundler still pulls the packages in. `@xmldom/xmldom` in particular ships
 * XML-injection and uncontrolled-recursion advisories in the range kdbxweb
 * declares. Both are replaced by local stubs in tools/stubs/.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const DIST = 'dist';

/**
 * Strings unique to the *real* implementations. The bare specifier
 * "@xmldom/xmldom" is useless as a marker: it survives as a literal in kdbxweb's
 * UMD wrapper even when the import resolves to our stub.
 */
const FORBIDDEN = [
  {
    needle: 'entityMap',
    why: 'Real @xmldom/xmldom was bundled; it must resolve to tools/stubs/xmldom (D-007).',
  },
  {
    needle: '__DOMHandler',
    why: 'Real @xmldom/xmldom was bundled; it must resolve to tools/stubs/xmldom (D-007).',
  },
];

/** Sentinel emitted by both stubs in tools/stubs/. */
const STUB_MARKER = 'living-spec D-007';

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

/**
 * Host configuration that must reach the deployed output.
 *
 * These are not cosmetic. Without the SPA rewrite, /auth/callback 404s on a
 * static host and OAuth can never complete. Without frame-ancestors, the app is
 * clickjackable — and that directive cannot be expressed in the meta-tag CSP
 * that covers everything else.
 */
const REQUIRED_HOST_CONFIG = [
  {
    file: '_redirects',
    needles: ['/index.html   200'],
    why: 'SPA fallback, without which /auth/callback 404s and OAuth cannot complete.',
  },
  {
    file: '_headers',
    needles: [
      "frame-ancestors 'none'",
      'X-Content-Type-Options: nosniff',
      'Referrer-Policy: no-referrer',
      'Strict-Transport-Security:',
    ],
    why: 'Security headers SECURITY.md states are set at the host.',
  },
];

async function checkHostConfig(root) {
  const failures = [];
  for (const { file, needles, why } of REQUIRED_HOST_CONFIG) {
    let content;
    try {
      content = await readFile(join(root, file), 'utf8');
    } catch {
      failures.push(`  ${file} is missing from the build output.\n    ${why}`);
      continue;
    }
    for (const needle of needles) {
      if (!content.includes(needle)) {
        failures.push(`  ${file} no longer contains "${needle}".\n    ${why}`);
      }
    }
  }
  return failures;
}

async function main() {
  try {
    await stat(DIST);
  } catch {
    console.error(`verify:bundle — no ${DIST}/ directory. Run "npm run build" first.`);
    process.exit(1);
  }

  const scripts = [];
  for await (const file of walk(DIST)) {
    if (['.js', '.mjs', '.cjs'].includes(extname(file))) {
      scripts.push(file);
    }
  }

  if (scripts.length === 0) {
    console.error('verify:bundle — no JavaScript found in dist/. Did the build succeed?');
    process.exit(1);
  }

  const failures = [];
  let sawKdbxweb = false;
  let sawStubMarker = false;

  for (const file of scripts) {
    const source = await readFile(file, 'utf8');

    if (source.includes('kdbxweb')) sawKdbxweb = true;
    if (source.includes(STUB_MARKER)) sawStubMarker = true;

    for (const { needle, why } of FORBIDDEN) {
      if (source.includes(needle)) {
        failures.push(`  ${file}\n    contains "${needle}"\n    ${why}`);
      }
    }
  }

  // Only meaningful once the format layer actually imports kdbxweb (Phase 1).
  // Until then this is inert by design rather than silently passing forever.
  if (sawKdbxweb && !sawStubMarker) {
    failures.push(
      '  kdbxweb is bundled but neither stub is present.\n' +
        '    Expected tools/stubs/ to satisfy its "crypto" and "@xmldom/xmldom"\n' +
        '    imports (D-007). Check the overrides in package.json.',
    );
  }

  // dist/<project>/browser is where assets land; find it rather than hard-coding.
  const browserRoot = scripts[0]?.replace(/[^/]+$/, '') ?? DIST;
  failures.push(...(await checkHostConfig(browserRoot)));

  if (failures.length > 0) {
    console.error(`verify:bundle — FAILED\n\n${failures.join('\n\n')}\n`);
    process.exit(1);
  }

  const note = sawKdbxweb
    ? 'kdbxweb present, stubs verified'
    : 'kdbxweb not yet imported — stub checks inert until the format layer lands';
  console.log(
    `verify:bundle — OK (${scripts.length} scripts checked; host config present; ${note})`,
  );
}

await main();
