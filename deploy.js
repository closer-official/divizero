const { execSync } = require('child_process');
const fs = require('fs');
const message = process.argv[2] || 'update';

// Inject deploy message into index.html
const html = fs.readFileSync('index.html', 'utf8');
const updated = html.replace(/const DEPLOY_MSG = '.*?';/, `const DEPLOY_MSG = '${message}';`);
fs.writeFileSync('index.html', updated, 'utf8');

execSync('git add -A', { stdio: 'inherit' });
execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
execSync('git push', { stdio: 'inherit' });
