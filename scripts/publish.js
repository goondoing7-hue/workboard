// Publish completed source changes to the existing Git-linked production site.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourcePaths = ['.gitignore', '.env.example', 'AGENTS.md', 'README.md', 'package.json', 'package-lock.json',
  'tailwind.config.js', 'vercel.json', 'netlify.toml', 'src', 'scripts', 'server', 'api',
  'netlify/functions', 'public', 'tests', 'docs'];
const allowed = (file) => sourcePaths.some((entry) => file === entry || file.startsWith(`${entry}/`));
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(capture ? `${command} 실행 실패: ${result.stderr.trim()}` : `${command} 실행 실패`);
  return capture ? result.stdout.trim() : '';
}
const git = (...args) => run('git', args, true);
try {
  if (git('branch', '--show-current') !== 'main') throw new Error('배포는 main 브랜치에서 실행해 주세요.');
  const remote = git('remote', 'get-url', 'origin').replace(/\.git$/, '');
  if (remote !== 'https://github.com/goondoing7-hue/workboard') throw new Error('기존 workboard GitHub 저장소 연결을 확인해 주세요.');
  const staged = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
  if (staged.some((file) => !allowed(file))) throw new Error('배포 대상 외의 파일이 미리 선택되어 있습니다. Git 스테이징을 확인해 주세요.');
  run('git', ['fetch', 'origin', 'main']);
  const remoteHead = git('rev-parse', 'origin/main');
  if (git('merge-base', 'HEAD', 'origin/main') !== remoteHead) throw new Error('GitHub에 새 변경이 있습니다. 먼저 가져와 병합한 후 배포해 주세요.');
  const tests = fs.readdirSync(path.join(root, 'tests')).filter((name) => name.endsWith('.test.mjs')).map((name) => `tests/${name}`);
  run(process.execPath, ['--test', '--experimental-test-isolation=none', ...tests]);
  run(process.execPath, ['scripts/build.js']);
  run('git', ['add', '--', ...sourcePaths.filter((file) => fs.existsSync(path.join(root, file)))]);
  if (git('diff', '--cached', '--name-only')) {
    const message = process.argv.slice(2).join(' ').trim() || 'Update workboard';
    run('git', ['commit', '-m', message]);
  }
  run('git', ['push', 'origin', 'main']);
  console.log('\nGitHub 반영 완료. Vercel 자동 배포가 시작됩니다.');
  console.log('배포 상태: https://vercel.com/lovlive-s-projects/workboard/deployments');
  console.log('온라인 주소: https://workboard-beta.vercel.app');
} catch (error) {
  console.error(`배포 중단: ${error.message}`);
  process.exitCode = 1;
}
