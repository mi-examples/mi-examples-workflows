import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractSection, insertSection } from './changelog.mjs';

const SECTION = '## [1.3.0](https://x/compare/v1.2.0...v1.3.0) (2026-09-24)\n\n### Features\n\n* new thing\n';

// What semantic-release left behind in the package repos: no title, H1 for
// minor releases, H2 for patches, extra blank lines.
const SEMANTIC_RELEASE_CHANGELOG = [
  '# [1.2.0-beta.1](https://x/compare/v1.1.0...v1.2.0-beta.1) (2026-09-20)',
  '',
  '',
  '### Features',
  '',
  '* beta thing',
  '',
  '',
  '',
  '## [1.1.1](https://x/compare/v1.1.0...v1.1.1) (2026-09-01)',
  '',
  '* old fix',
  '',
].join('\n');

describe('insertSection', () => {
  it('creates a changelog with a title', () => {
    assert.equal(insertSection('', SECTION, '1.3.0'), `# Changelog\n\n${SECTION}`);
  });

  it('inserts below an existing title', () => {
    const result = insertSection('# Changelog\n\n## 1.2.0 (2026-09-01)\n\n* old\n', SECTION, '1.3.0');

    assert.equal(result, `# Changelog\n\n${SECTION}\n## 1.2.0 (2026-09-01)\n\n* old\n`);
  });

  it('adds a title above a semantic-release changelog and keeps old entries byte-for-byte', () => {
    const result = insertSection(SEMANTIC_RELEASE_CHANGELOG, SECTION, '1.3.0');

    assert.equal(result, `# Changelog\n\n${SECTION}\n${SEMANTIC_RELEASE_CHANGELOG}`);
  });

  it('replaces an existing section for the same version', () => {
    const once = insertSection('# Changelog\n\n## 1.2.0 (2026-09-01)\n\n* old\n', SECTION, '1.3.0');
    const edited = SECTION.replace('new thing', 'edited thing');
    const twice = insertSection(once, edited, '1.3.0');

    assert.equal(twice, `# Changelog\n\n${edited}\n## 1.2.0 (2026-09-01)\n\n* old\n`);
  });

  it('normalizes CRLF input', () => {
    assert.equal(insertSection('# Changelog\r\n', SECTION.replaceAll('\n', '\r\n'), '1.3.0'), `# Changelog\n\n${SECTION}`);
  });
});

describe('extractSection', () => {
  const changelog = insertSection(SEMANTIC_RELEASE_CHANGELOG, SECTION, '1.3.0');

  it('returns the body of a section without its heading', () => {
    assert.equal(extractSection(changelog, '1.3.0'), '### Features\n\n* new thing\n');
    assert.equal(extractSection(changelog, 'v1.3.0'), '### Features\n\n* new thing\n');
  });

  it('can include the heading', () => {
    assert.equal(extractSection(changelog, '1.3.0', { withHeading: true }), SECTION);
  });

  it('finds semantic-release and Keep a Changelog headings', () => {
    assert.equal(extractSection(changelog, '1.2.0-beta.1'), '### Features\n\n* beta thing\n');
    assert.equal(extractSection(changelog, '1.1.1'), '* old fix\n');
    assert.equal(extractSection('## [0.10.0] - 2024-03-21\n\n- added x\n', '0.10.0'), '- added x\n');
  });

  it('does not confuse a version with its prereleases', () => {
    assert.equal(extractSection(changelog, '1.2.0'), null);
  });
});
