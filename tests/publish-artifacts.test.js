const test = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('FTP publishing: extracted files, matching manual, duplicate detection, TLS, target folder and source build validation', () => {
  execFileSync('python3', [path.join(__dirname, 'publish_artifacts_test.py')], { encoding: 'utf8', stdio: 'pipe' });
});
