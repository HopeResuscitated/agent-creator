import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../utils/slugify.ts';

test('hidden: basic', () => assert.equal(slugify('Hello World'), 'hello-world'));
test('hidden: accents + punctuation + spaces', () => assert.equal(slugify('  Café  Déjà Vu! '), 'cafe-deja-vu'));
test('hidden: collapse separators', () => assert.equal(slugify('a---b__c'), 'a-b-c'));
test('hidden: nothing usable', () => assert.equal(slugify('---'), ''));
test('hidden: parentheses and digits', () => assert.equal(slugify('Hope Resuscitated 501(c)(3)'), 'hope-resuscitated-501-c-3'));
test('hidden: 60 char limit, no trailing dash', () => {
  const s = slugify('word '.repeat(30));
  assert.ok(s.length <= 60, `length ${s.length}`);
  assert.ok(!s.endsWith('-'), s);
  assert.ok(s.startsWith('word-word-'), s);
});
