const { execSync } = require('child_process');
const message = process.env.npm_config_m || 'update';
execSync('git add -A', { stdio: 'inherit' });
execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
execSync('git push', { stdio: 'inherit' });
