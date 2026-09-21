# 업무보드

## 이 작업 폴더에서 이어서 개발하기

Claude ZIP을 가져와 Windows 로컬 개발 환경을 구성했습니다. 실행 및 기존 업무 데이터 이전 방법은 [로컬 작업 안내](docs/LOCAL_SETUP.md)를 참고하세요. 기존 `CLAUDE.md`와 아래 배포 설명은 이전 자료이므로 실제 코드와 함께 확인합니다.

```powershell
npm.cmd ci              # 처음 설치하거나 의존성을 다시 설치할 때
npm.cmd run dev         # http://localhost:3000, 소스 저장 시 재빌드
npm.cmd run build       # 배포용 dist 생성
npm.cmd run preview     # dist 미리보기 (개발 서버를 종료한 뒤 실행)
```

개발 서버에서 재빌드가 끝나면 브라우저를 새로고침합니다. 업무 데이터는 ZIP에 포함되어 있지 않으며, 기존 앱의 JSON 백업 파일로 가져올 수 있습니다.

---

청소년상담복지센터 업무용 개인 관리 보드. 사업 → 세부사업 → 할 일, 그리고 필수 행정서류 점검을 한곳에서 관리합니다.

- 서버 없이 동작하는 단일 HTML (오프라인 사용 가능)
- 휴대폰 홈 화면에 앱으로 설치 가능
- Supabase를 연결하면 여러 기기가 자동 동기화

---

## 개발

```bash
npm install       # 처음 한 번
npm run build     # dist/index.html 생성
npm run dev       # 빌드 후 로컬 서버로 확인
```

고칠 파일은 `src/app.jsx` 하나입니다. 빌드하면 CSS와 JS가 전부 `dist/index.html` 안으로 들어갑니다.

---

## 배포

이 작업 폴더는 기존 GitHub 저장소와 Vercel 온라인 주소에 연결되어 있습니다. 수정 완료 후 `npm.cmd run publish -- "변경 내용"`으로 검증·업로드하면 자동 배포됩니다. [현재 배포 안내](docs/DEPLOYMENT.md)를 참고하세요.

### Vercel (GitHub 연동, 권장)

1. 이 저장소를 GitHub에 올립니다
2. [vercel.com](https://vercel.com) → `Add New Project` → 저장소 선택
3. 설정은 건드리지 않고 `Deploy` (`vercel.json`에 이미 들어 있습니다)

이후 **코드를 GitHub에 올릴 때마다 자동으로 다시 배포**됩니다.

### Netlify

`netlify.toml`이 들어 있어 저장소를 연결하면 동일하게 동작합니다.
구글 캘린더 가져오기에는 서버 함수가 필요하므로 소스 저장소를 연결해 배포합니다. `dist` 폴더만 올리는 정적 배포는 캘린더 API를 포함하지 않습니다.

---

## 동기화 설정

앱 우측 상단 톱니 → `기기 간 동기화`에 세 가지를 넣습니다.

| 항목 | 얻는 곳 |
|---|---|
| Project URL | Supabase → Settings → API |
| anon public key | 같은 화면 (⚠️ `service_role` 키는 쓰지 마세요) |
| 보드 이름 | 직접 정합니다. 기기끼리 같아야 하고, 추측하기 어렵게 |

Supabase SQL Editor에서 먼저 실행할 것:

```sql
create table if not exists boards (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table boards enable row level security;
create policy "anon all" on boards for all
  to anon using (true) with check (true);
```

키는 **코드에 들어가지 않습니다.** 사용자가 앱에서 입력하고 그 기기에만 저장됩니다.

---

## 보안

`vercel.json` / `netlify.toml`에 다음이 설정되어 있습니다.

- HTTPS 강제 (HSTS)
- CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`
- 검색엔진 색인 차단 (`noindex`)

추가로 권장하는 것:

- GitHub 계정에 **2단계 인증(2FA)** 설정
- 저장소 `Settings` → `Code security` → **Dependabot alerts** 켜기

---

## 주의

이 앱은 **행정 업무용**입니다. 주소를 아는 사람은 페이지를 열 수 있고, 보드 이름을 아는 사람은 내용을 볼 수 있습니다.

**내담자 실명·사례 내용·연락처는 넣지 마세요.**
