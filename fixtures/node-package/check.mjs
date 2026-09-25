import assert from 'node:assert/strict';

const { greet } = await import('./dist/index.mjs');

assert.equal(greet('CI'), 'Hello, CI!');
assert.equal(process.env.FIXTURE_FLAG, 'on', 'env-vars input should reach the tests');
console.log('fixture checks passed');
