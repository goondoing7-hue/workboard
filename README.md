# 업무보드

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

### Vercel (GitHub 연동, 권장)

1. 이 저장소를 GitHub에 올립니다
2. [vercel.com](https://vercel.com) → `Add New Project` → 저장소 선택
3. 설정은 건드리지 않고 `Deploy` (`vercel.json`에 이미 들어 있습니다)

이후 **코드를 GitHub에 올릴 때마다 자동으로 다시 배포**됩니다.

### Netlify

`netlify.toml`이 들어 있어 저장소를 연결하면 동일하게 동작합니다.
빌드 없이 쓰시려면 `npm run build` 후 `dist` 폴더를 [app.netlify.com/drop](https://app.netlify.com/drop)에 끌어다 놓아도 됩니다. 이 경우 **배포 후 `Make public`을 눌러야** 휴대폰에서 열립니다.

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
