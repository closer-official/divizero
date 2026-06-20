import { execSync } from 'child_process';

const message = process.argv[2] || 'update';

execSync('git add -A', { stdio: 'inherit' });
execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
execSync('git push', { stdio: 'inherit' });
