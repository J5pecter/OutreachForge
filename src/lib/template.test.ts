import test from 'node:test';
import assert from 'node:assert/strict';
import { render, extractTokens } from './template';

test('render substitutes merge fields', () => {
  assert.equal(render('Hi {{firstName}} at {{company}}', { firstName: 'Dana', company: 'Acme' }), 'Hi Dana at Acme');
});

test('render html-escapes values by default', () => {
  assert.equal(render('Hi {{firstName}}', { firstName: 'A & B <x>' }), 'Hi A &amp; B &lt;x&gt;');
});

test('render resolves nested attribute paths', () => {
  assert.equal(render('{{attributes.industry}}', { attributes: { industry: 'SaaS' } }), 'SaaS');
});

test('render throws in strict mode on an empty field', () => {
  assert.throws(() => render('Hi {{firstName}}', {}, { strict: true }));
});

test('render leaves empty fields blank in non-strict mode', () => {
  assert.equal(render('Hi {{firstName}}', {}, { strict: false }), 'Hi ');
});

test('render allows an empty optional token in strict mode', () => {
  assert.equal(render('Hi {{firstName}}. {{ai}}', { firstName: 'Dana', ai: '' }, { strict: true, optional: ['ai'] }), 'Hi Dana. ');
});

test('render still fails on a non-optional empty token in strict mode', () => {
  assert.throws(() => render('{{firstName}} {{ai}}', { firstName: '', ai: 'x' }, { strict: true, optional: ['ai'] }));
});

test('extractTokens returns each referenced token', () => {
  assert.deepEqual(extractTokens('{{a}} then {{b.c}} and {{a}}').sort(), ['a', 'b.c']);
});
