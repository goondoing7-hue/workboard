# 상담 실적 관리 독립 배포 구성

기존 업무보드 전체 빌드는 유지하고, 독립 프로젝트에서는 다음 명령을 사용한다.

```sh
node scripts/build.js --performance-only
```

이 모드는 `src/app.jsx`, ADHD 화면, Tailwind를 빌드하지 않는다. 실적 앱을 `dist/index.html`로 만들고 같은 내용의 `dist/performance.html` 별칭을 제공한다. 전용 아이콘·공유 이미지, 실적 전용 manifest, 독립 서비스 워커를 함께 생성한다. 기존 전체 빌드 파일이 같은 출력 폴더에 남지 않도록 프로젝트 바로 아래의 `dist`만 비운다. `--dev`를 함께 사용하면 `.dev`를 사용한다. 심볼릭 링크인 출력 경로는 거절한다.

## 최소 소스 목록

2026-09-23 현재 실적 화면과 두 Google API에 필요한 파일이다. 실제 데이터, 원본 문서, 기존 브라우저 백업, `.env` 파일, `artifacts`, 기존 Git 이력을 복사하지 않는다.

```text
scripts/build.js
src/performance.jsx
src/performance.css
src/performanceApprovalCatalog.mjs
src/performanceApprovals.jsx
src/performanceApprovals.css
src/performanceCalendar.jsx
src/performanceDeployment.mjs
src/performanceDomain.mjs
src/performanceMilitary.jsx
src/performanceMilitary.css
src/performanceMilitaryDomain.mjs
src/performancePersistence.mjs
src/performanceSchedule.jsx
src/performanceSchedule.css
src/performanceScheduleDomain.mjs
src/performanceStore.jsx
src/performanceWorkboardConnection.jsx
src/performanceWorkboardLink.mjs
src/counselingDomain.mjs
server/performanceSheets.cjs
server/performanceCalendar.cjs
api/performance-sheets.js
api/performance-calendar.js
public/performance-icon.svg
public/performance-icon-32.png
public/performance-icon-192.png
public/performance-share-v1.png
package.json
package-lock.json
vercel.json
.gitignore
```

`counselingDomain.mjs`는 `performanceWorkboardLink.mjs`의 업무보드 예약 완료 상태 판정에 필요하다. 실적 앱은 `performanceDeployment.mjs`와 `performanceWorkboardConnection.jsx`로 별도 origin의 업무보드와 연결한다. 업무보드 쪽 `WorkboardPerformanceLink` 컴포넌트(`src/workboardPerformanceLink.jsx`)는 기존 업무보드 루트 화면에 포함하며 독립 실적 저장소에는 필요하지 않다. 별도의 bridge HTML 페이지를 만들지 않고 업무보드 URL의 hash로 연결 nonce와 모드를 전달한다. 기존 `public/sw.js`, 업무보드 manifest, 업무보드 아이콘, `src/app.jsx`, `src/adhd.jsx`, Tailwind 입력 파일은 독립 빌드에 필요하지 않다.

소스와 함께 유지할 회귀 테스트는 `tests/performance*.test.mjs`다. 위 최소 런타임 목록에는 테스트 파일을 생략했지만 실제 독립 저장소에는 테스트와 관련 운영 문서를 함께 보관하는 편이 좋다. 새 연결 모듈의 테스트·fixture가 추가되면 의존성을 함께 복사한다.

## 독립 package.json

현재 구현의 최소 패키지는 `react`, `react-dom`, `lucide-react`와 빌드용 `esbuild`다. 두 서버 API는 Node.js 내장 모듈과 전역 `fetch`를 사용한다. `ical.js`와 `tailwindcss`는 독립 실적 빌드에 필요하지 않다.

```json
{
  "name": "counseling-performance",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "node scripts/build.js --performance-only",
    "test": "node --test --experimental-test-isolation=none tests/*.test.mjs"
  },
  "engines": { "node": ">=22" },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "lucide-react": "^0.383.0"
  },
  "devDependencies": { "esbuild": "^0.25.12" }
}
```

독립 package.json에 맞는 lockfile을 생성한 뒤 저장소에 함께 커밋한다. 기존 업무보드용 publish 명령은 저장소 이름과 main 브랜치를 고정 확인하므로 새 프로젝트에 그대로 복사하여 실행하지 않는다.

## 공개 빌드 설정

빌드는 민감한 환경변수를 프런트엔드에 주입하지 않는다. 다음 공개 origin 두 개만 사용한다.

| 환경변수 | 용도 | 기본값 |
|---|---|---|
| `PERFORMANCE_APP_ORIGIN` | 실적 앱 canonical·OG 이미지 URL 및 앱 연결 대상 | 독립 모드는 `https://counseling-performance.vercel.app`, 전체 모드는 기존 `https://workboard-beta.vercel.app` |
| `WORKBOARD_ORIGIN` | 실적 앱에서 연결할 기존 업무보드 origin | `https://workboard-beta.vercel.app` |

주소에는 경로·쿼리·해시·후행 `/`를 넣지 않는다. HTTPS origin만 허용하며 로컬 개발의 localhost·127.0.0.1·[::1]만 HTTP를 허용한다. 신규 Vercel 주소가 확정되면 독립 프로젝트와 기존 업무보드 프로젝트의 `PERFORMANCE_APP_ORIGIN`을 같은 확정 주소로 설정한다. 코드에서 기본 후보 도메인의 사용 가능성을 보장하지 않는다.

esbuild는 업무보드·실적 번들에 다음 컴파일 상수를 제공한다.

```js
__WORKBOARD_ORIGIN__
__PERFORMANCE_APP_ORIGIN__
__PERFORMANCE_STANDALONE__
```

새 코드가 번들 밖의 테스트에서도 실행된다면 `typeof __WORKBOARD_ORIGIN__ !== 'undefined'`처럼 존재 여부를 확인한 뒤 기본값을 사용한다. 독립 모드의 canonical·`og:url`은 `${PERFORMANCE_APP_ORIGIN}/`이며 루트와 `performance.html` 별칭 모두 이 주소를 가리킨다. 전체 빌드의 기존 실적 페이지 canonical은 `${PERFORMANCE_APP_ORIGIN}/performance.html`이다. 대표 이미지 URL도 같은 origin을 사용한다.

## Vercel의 정적 페이지와 API

Vercel은 `dist`의 정적 결과물과 프로젝트 루트의 `api` 서버 함수를 별도로 배포한다. 빌드 결과에 `api`나 `vercel.json`을 복사하는 방식은 사용하지 않는다. 독립 저장소의 루트에 다음 설정을 두고, 기존 프로젝트의 보안 헤더·CSP도 해당 앱에 맞춰 유지한다.

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": null,
  "functions": {
    "api/performance-sheets.js": {
      "includeFiles": "server/performanceSheets.cjs"
    },
    "api/performance-calendar.js": {
      "includeFiles": "server/performanceCalendar.cjs"
    }
  },
  "headers": [
    {
      "source": "/sw.js",
      "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }]
    },
    {
      "source": "/",
      "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }]
    },
    {
      "source": "/index.html",
      "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }]
    },
    {
      "source": "/performance.html",
      "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }]
    }
  ]
}
```

OAuth와 외부 통신을 허용하는 CSP는 기능에 필요한 Google origin을 유지한다. 두 Google API의 서버 설정은 프로젝트의 서버 환경변수로 별도 구성하며 소스에 넣지 않는다. 새 사이트 origin을 Google OAuth의 승인된 JavaScript origin 및 서버 허용 origin에 등록해야 한다. 기존 브라우저의 HttpOnly 쿠키는 새 origin으로 이전되지 않으므로 새 앱에서 Google Drive·수련 캘린더를 다시 승인한다.

## 업무보드와의 연결 및 데이터 보존

GitHub 저장소·Vercel 프로젝트를 분리하면 브라우저 origin도 달라지므로 `localStorage`, IndexedDB, 인증 쿠키가 자동 공유되지 않는다. 링크만 바꿔서는 기존 실적이나 업무보드 완료 기록을 가져올 수 없다. 실적 앱의 기존 자료 이전 기능은 업무보드 루트 화면을 열고, URL hash의 임시 nonce·연결 모드와 양쪽 창·origin을 검증한 뒤 저장 자료를 전달한다. Google Sheets 복구와 파일 백업 가져오기도 사용할 수 있다.

업무보드 완료 상담 연결과 기존 실적 이전은 목적을 구분한다. 완료 상담 연결은 상담일지·이름·연락처·첨부자료를 제외한 집계용 필드만 전달하며, 기존에 가져온 동일 ID 기록의 수정이나 삭제를 발견해도 실적과 인정을 조용히 덮어쓰지 않는다. 기존 실적 이전은 실적 앱의 변경 이력을 그대로 병합하여 활동 기록·학회별 승인·수퍼바이저·수련 일정과 기존 ID를 보존한다. Google 연결 대상 ID를 유지할 수 있지만 인증 토큰이나 쿠키는 전송하지 않는다.

교차 origin 연결은 상대 origin·창·nonce·요청 ID를 확인한 메시지만 처리한다. 양쪽 화면이 열려 있고 연결이 활성화된 동안 완료 상담 변경을 전달한다. 창을 닫았거나 브라우저가 종료된 상태에서 계속 동작하는 서버 간 실시간 동기화는 아니다. 이 경우 기존에 가져온 실적은 보존되며 다시 연결하거나 가져오기를 실행할 수 있다.

자료 이전이 완료되어도 예전 업무보드 origin의 실적과 업무보드 원본을 삭제하지 않는다. 같은 자료를 다시 이전해도 안정적인 변경 ID로 병합하여 중복 생성을 막는다. Google Sheets 복구·파일 백업·창 연결을 혼용할 때도 승인 이력과 기존 자료를 유지한다.

독립 서비스 워커의 캐시 이름은 `counseling-performance-`로 시작하며 실적 HTML·아이콘·manifest만 저장한다. API와 외부 Google 응답은 캐시하지 않는다. 업무보드 HTML은 독립 프로젝트에 포함하지 않으며, 오프라인일 때도 실적 앱만 연다.
