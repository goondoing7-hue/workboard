// Import a user-downloaded Google web OAuth client JSON without printing secrets.
// The resulting .env.local is ignored by Git and read only by the local server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');

const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env.local');
try {
  if (!process.argv[2]) throw new Error('Google에서 다운로드한 웹 OAuth 클라이언트 JSON 파일 경로가 필요합니다.');
  const source = path.resolve(process.argv[2]);
  if (fs.statSync(source).size > 65536) throw new Error('OAuth 클라이언트 JSON 파일을 확인해 주세요.');
  const web = JSON.parse(fs.readFileSync(source, 'utf8')).web;
  if (!web || !/^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(web.client_id || '')
    || typeof web.client_secret !== 'string' || web.client_secret.length < 12
    || /[\s"'\\\r\n]/.test(web.client_secret) || web.client_secret.includes('****')) {
    throw new Error('클라이언트 보안 비밀번호가 포함된 웹 애플리케이션 JSON이 필요합니다.');
  }
  const oldText = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const old = parseEnv(oldText);
  if (old.GOOGLE_CALENDAR_CLIENT_ID && old.GOOGLE_CALENDAR_CLIENT_ID !== web.client_id) {
    throw new Error('이미 다른 캘린더 클라이언트가 설정되어 있습니다. 기존 연결을 확인한 뒤 변경해 주세요.');
  }
  const key = old.GOOGLE_CALENDAR_SESSION_KEY || crypto.randomBytes(32).toString('base64url');
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('기존 세션 암호화 키 형식을 확인해 주세요.');
  const config = {
    GOOGLE_CALENDAR_CLIENT_ID: web.client_id,
    GOOGLE_CALENDAR_CLIENT_SECRET: web.client_secret,
    GOOGLE_CALENDAR_SESSION_KEY: key,
    GOOGLE_CALENDAR_ID: '6ji8k3imcg4khv32qnef1b4p90@group.calendar.google.com',
    GOOGLE_CALENDAR_ORIGINS: 'https://workboard-beta.vercel.app,http://localhost:3000',
  };
  // Preserve unrelated environment settings without copying them into console output.
  const lines = oldText.split(/\r?\n/).filter((line) => !/^\s*(?:export\s+)?GOOGLE_CALENDAR_[A-Z_]+\s*=/.test(line));
  const result = lines.join('\n').trimEnd() + '\n' + Object.entries(config).map(([name, value]) => `${name}=${value}`).join('\n') + '\n';
  fs.writeFileSync(target, result, { mode: 0o600 });
  console.log('캘린더 서버 설정을 .env.local에 저장했습니다. 비밀값은 표시하지 않습니다.');
  console.log('로컬 서버를 다시 시작한 뒤 Google 권한을 한 번 연결해 주세요.');
} catch {
  // Avoid echoing JSON parse fragments or credential contents in error messages.
  console.error('설정하지 못했습니다. 유효한 웹 OAuth JSON 경로와 기존 .env.local 설정을 확인해 주세요.');
  process.exitCode = 1;
}
