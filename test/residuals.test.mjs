import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { auditResiduals, observedDifferences } from '../build/residuals.mjs';

const declared = {
  categories: { fix: 'a kit fix' },
  residuals: {
    'hooks/a.mjs': { kind: 'content', category: 'fix', reason: 'r' },
    'lib/gone.mjs': { kind: 'missing', category: 'fix', reason: 'r' },
  },
};

describe('observedDifferences', () => {
  test('classifies missing, extra, mode and content, and lets a version-only change through as version', () => {
    const result = {
      missing: ['lib/gone.mjs'], extra: ['lib/new.mjs'], mode: [{ rel: 'hooks/x.mjs' }],
      content: [{ rel: 'hooks/a.mjs' }, { rel: 'package.json' }],
    };
    const found = observedDifferences(result, (rel) => rel === 'package.json');
    assert.deepEqual(Object.fromEntries(found), {
      'lib/gone.mjs': 'missing', 'lib/new.mjs': 'extra', 'hooks/x.mjs': 'mode', 'hooks/a.mjs': 'content', 'package.json': 'version',
    });
  });

  test('ignores paths the caller allows outright', () => {
    const found = observedDifferences({ missing: [], extra: [], mode: [], content: [{ rel: 'README.md' }] }, () => false, new Set(['README.md']));
    assert.equal(found.size, 0);
  });
});

describe('auditResiduals', () => {
  test('passes when every difference is declared with the observed kind', () => {
    const found = new Map([['hooks/a.mjs', 'content'], ['lib/gone.mjs', 'missing'], ['package.json', 'version']]);
    assert.deepEqual(auditResiduals(found, declared), []);
  });

  test('fails on an undeclared difference', () => {
    const found = new Map([['hooks/a.mjs', 'content'], ['lib/gone.mjs', 'missing'], ['hooks/b.mjs', 'content']]);
    assert.deepEqual(auditResiduals(found, declared), ['undeclared content: hooks/b.mjs']);
  });

  test('fails on a kind mismatch', () => {
    const found = new Map([['hooks/a.mjs', 'extra'], ['lib/gone.mjs', 'missing']]);
    assert.deepEqual(auditResiduals(found, declared), ['hooks/a.mjs: declared content, observed extra']);
  });

  test('fails on a stale declaration', () => {
    const found = new Map([['hooks/a.mjs', 'content']]);
    assert.deepEqual(auditResiduals(found, declared), ['stale declaration (no longer differs): lib/gone.mjs']);
  });

  test('fails on a declaration without a reason or with an unknown category', () => {
    const bad = { categories: { fix: 'x' }, residuals: { 'a.mjs': { kind: 'content', category: 'nope' }, 'b.mjs': { kind: 'content', category: 'fix' } } };
    const found = new Map([['a.mjs', 'content'], ['b.mjs', 'content']]);
    assert.deepEqual(auditResiduals(found, bad), ['a.mjs: unknown category nope', 'a.mjs: no reason given', 'b.mjs: no reason given']);
  });
});
