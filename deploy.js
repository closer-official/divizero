import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

// Parse message from: -m "text" / --m="text" / positional arg
const args = process.argv.slice(2);
let message = '';
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '-m' || args[i] === '--m') && args[i + 1]) {
    message = args[i + 1]; break;
  } else if (args[i].startsWith('--m=')) {
    message = args[i].slice(4); break;
  } else if (args[i].startsWith('-m=')) {
    message = args[i].slice(3); break;
  } else if (!args[i].startsWith('-')) {
    message = args[i]; break;
  }
}
if (!message) {
  console.error('使い方: npm run deploy -- -m "コミットメッセージ"');
  process.exit(1);
}

// Write build label into the app (date + message)
const today = new Date().toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }).replace('/', '/');
const label = `${today} ${message}`;
writeFileSync('./src/buildInfo.ts', `export const BUILD_LABEL = "${label}";\n`);

execSync('git add -A', { stdio: 'inherit' });

// Only commit if there are staged changes
const status = execSync('git status --porcelain').toString().trim();
if (status) {
  execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
} else {
  console.log('変更なし — 既存のコミットをプッシュします');
}

execSync('git push', { stdio: 'inherit' });
