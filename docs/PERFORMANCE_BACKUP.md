# 상담 실적 전용 앱의 Google Sheets 자동 백업

실적 앱은 기존 업무보드 데이터와 분리된 저장소를 사용한다. 화면에서 저장한 변경을 먼저 기기에 보관하고, Google 연결 후 앱이 열려 있고 온라인이면 저장 대기 변경을 전송한다. 시트의 기존 행을 덮어쓰거나 삭제하지 않는 **변경 이력 추가 방식**이다. 삭제도 `payload.deleted: true`인 새로운 변경으로 남는다.

## 최초 연결 설정

기존 캘린더 OAuth 설정 중 다음 서버 환경변수를 재사용한다. 클라이언트 비밀과 세션 키를 HTML, 브라우저 저장 데이터, 로그에 넣지 않는다.

| 환경변수 | 용도 |
| --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | 기존 Google 웹 OAuth 클라이언트 |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | 서버 전용 OAuth 비밀 |
| `GOOGLE_CALENDAR_SESSION_KEY` | 32바이트 base64url AES-GCM 암호화 키 |
| `GOOGLE_CALENDAR_ORIGINS` | 허용된 정확한 origin의 쉼표 구분 목록 |
| `PERFORMANCE_CONNECTION_PASSWORD` | 선택 사항. 구성하면 최초 Google 연결 전에 입력 필요 |
| `WORKBOARD_CONNECTION_PASSWORD` | 위 값이 없을 때 사용하는 선택적 연결 비밀번호 |

비밀번호 환경변수가 없으면 본인의 Google 계정 OAuth 승인과 비공개 시트 소유권으로 인증한다. 임의 기본 비밀번호는 없다. `GOOGLE_CALENDAR_ID`는 실적 시트 연결에 필요하지 않다.

1. 같은 Google Cloud 프로젝트에서 **Google Drive API와 Google Sheets API**를 활성화한다.
2. OAuth 동의 화면에서 `https://www.googleapis.com/auth/drive.file` 범위를 허용한다. 앱이 생성하거나 명시적으로 접근 권한을 받은 파일 범위이다. 서버는 이 중 앱 표식이 있는 본인 소유 비공개 실적 시트만 사용한다.
3. 기존 웹 OAuth 클라이언트의 승인된 JavaScript 원본에 실제 origin이 있어야 한다. 예: `https://workboard-beta.vercel.app`. 이 값과 서버 허용 origin을 일치시킨다.
4. 실적 앱에서 Google 연결을 누르고 사용할 개인 Google 계정으로 승인한다. OAuth Testing 상태면 테스트 사용자로 추가되어 있어야 한다.

기존 캘린더와 같은 GIS **popup code flow**를 사용한다. 프런트는 `initCodeClient({ ux_mode: 'popup', include_granted_scopes: false, scope: driveFileScope })`에서 받은 일회성 code만 서버로 전달한다. 서버 token 교환의 `redirect_uri`는 페이지 origin이다. 새 `/api/...callback` URI 등록이나 기존 캘린더 callback 변경은 필요하지 않다. access token은 서버 메모리, refresh token은 별도 AES-GCM 암호화 HttpOnly cookie에만 저장한다.

OAuth 외부 앱이 Testing 상태이면 이 권한의 refresh token은 일반적으로 7일 후 만료되므로 다시 승인해야 한다. 세션 쿠키 180일은 Google 토큰 수명을 늘리지 않는다. Production 전환은 실제 Google 프로젝트 정책과 승인 상태를 확인하여 별도로 진행한다.

## 저장 파일과 복구

- 최초 연결은 비공개 **상담 실적 자동백업** Google Sheet를 생성한다. 공유 권한을 만들지 않는다. 기존 파일이 발견되면 해당 파일을 재사용한다.
- 재연결 시 Drive의 `appProperties.workboardPerformance = v1` 표식으로만 검색한다. 같은 앱의 파일을 여러 개 발견하면 자동 선택하거나 새 파일을 만들지 않고 중단한다. 기존 시트 ID를 선택한 연결 요청을 사용한다.
- 매번 Google 소유권·비공개 상태·앱 표식·고정된 열 구성을 검증한다. 삭제·공유·형식 변경·API 실패가 있으면 자동 백업을 중단한다. 실패한 읽기 결과를 빈 자료로 처리하지 않는다.
- `실적기록` 탭은 변경 ID, 무결성 해시, 항목 ID, 이전 변경 ID, 저장 시각, 활동일, 활동 종류, 사례번호, 횟수, 인원, 분, 센터·수퍼바이저 인정 상태, 수행 상태, 완전복구 JSON을 보관한다.
- 이 탭은 **누적 변경 이력**이다. 수정 전·후 행과 삭제 이력이 함께 있으므로 시트 열을 단순 합산하면 실적이 중복될 수 있다. 현재 실적 합계는 앱이 항목별 최신 확정 버전을 복원하여 계산한다.
- 수식 실행을 막기 위해 모든 값은 Sheets API의 `RAW`로 기록한다. 시트의 열 순서, 변경 ID, 해시, JSON 또는 기존 행을 직접 편집·삭제하지 않는다. 실적 수정은 앱에서 한다.
- JSON과 SHA256을 검사하여 손상된 복구 기록을 감지한다. 표시용 열만 바꾸더라도 복구에는 원본 JSON이 사용된다.
- 같은 변경 ID의 재전송은 기존 행을 확인하고 다시 추가하지 않는다. 여러 서버가 동시에 동일 변경을 추가하면 물리적으로 중복 행이 생길 수 있으므로 앱은 변경 ID로 중복 제거한다. 서로 다른 내용의 같은 변경 ID는 충돌 오류로 보존한다. 수정 충돌은 `baseRevision` 및 `_resolves`를 이용하여 클라이언트가 판별·해결한다.
- 다른 Google 계정·시트로 연결이 바뀌면 기기의 저장 대기 기록을 자동으로 보내지 않고 사용자가 연결 대상을 확인한 후 진행해야 한다. append 요청에 `sheetId`를 포함하면 서버도 현재 연결과 일치하는지 검증한다.

자동 백업은 네트워크·Google 서비스 장애, 권한 만료, 브라우저 종료 중에는 완료되지 않는다. 기기에 저장된 변경과 Google 저장 완료 상태를 구분해서 표시해야 한다. Google 저장 대기가 남은 상태에서 브라우저 데이터를 삭제하면 아직 업로드되지 않은 자료를 잃을 수 있다. 중요한 월말 마감 자료는 앱에서 JSON 백업도 보관한다. 이 구현은 시트 직접 삭제를 복구하거나 Google 계정 자체의 유실을 대체하는 별도 저장 서비스는 아니다.

## API 계약

모든 정상 구성 요청은 same-origin, 쿠키 포함, `X-Workboard-Performance: 1` 헤더를 사용한다. POST는 JSON이어야 한다. GET은 브라우저가 Origin을 생략하면 같은 origin의 Referer가 필요하다. CORS는 허용하지 않는다.

| 요청 | 응답·역할 |
| --- | --- |
| `GET /api/performance-sheets?action=status` | `{configured,connected,passwordRequired,clientId,scope,sheet}`. sheet는 `{id,name,url}` 또는 null |
| `POST {action:'connect',password?}` | 10분 HttpOnly 연결허가 cookie와 `{clientId,scope,mode:'popup'}` |
| `POST {action:'exchange',code,sheetId?}` | 서버 code 교환, 기존 파일 발견/최초 생성, HttpOnly 세션 cookie, `{connected:true,sheet}` |
| `GET ?action=events&cursor=0` | `{events,nextCursor,sheet}`. 200개 단위, 마지막 `nextCursor:null`. **모든 페이지가 성공한 후** 로컬 기록에 병합 |
| `POST {action:'append',events,sheetId?}` | 최대 50개 변경. 확인된 `{acceptedIds,sheet}`만 로컬 outbox에서 완료 표시 |
| `POST {action:'disconnect'}` | 실적 기능 쿠키만 삭제. Google 파일·권한·기록은 유지 |

변경은 `{id,entityId,entityType:'record'|'profile',baseRevision?:string|null,createdAt:UTC_ISO,payload:object}`이며 한 변경은 JSON UTF-8 16,000바이트까지 지원한다. payload는 자유 텍스트 파일 첨부 본문 저장용이 아니다. 자료 파일은 별도 보관하고 증빙 식별 정보를 기록한다. `_resolves`와 삭제 표식을 포함한 payload는 그대로 복구된다.

Google 조회는 응답당 4MiB를 제한한다. 페이지별 복구는 200개로 나누지만 중복 검사 ID 색인이 4MiB를 초과하는 대규모 누적 이력에서는 업로드를 중단하고 대기 기록을 보존한다. 자동으로 오래된 변경을 지우지 않으며 해당 규모가 되면 별도 아카이브/데이터베이스 확장이 필요하다.

## 검증

`node --test tests/performanceSheets.test.mjs`는 실제 Google 데이터 없이 fetch mock으로 다음을 확인한다: 암호화 쿠키와 출처 검사, 선택적 비밀번호, 최소 scope, private app-owned 파일 제한, 최초 생성과 재연결, 페이지 복원, 응답 유실 후 중복 없는 재시도, 형식 손상·읽기 실패 시 기록 보존, token 갱신 실패, RAW 저장, 분리된 연결 해제.

Google 계정 승인·실제 시트 생성·배포 환경의 API 활성화는 이러한 단위 테스트가 확인하지 않는다. 실제 연결 후 소량의 임시 실적을 저장하고 Google 저장 완료 및 새 브라우저 세션의 복구까지 확인해야 한다.

## 공식 문서

- [GIS code model과 popup redirect_uri](https://developers.google.com/identity/oauth2/web/guides/use-code-model)
- [Google Sheets API 권한 범위](https://developers.google.com/workspace/sheets/api/scopes)
- [Google Drive 앱 전용 파일 속성](https://developers.google.com/workspace/drive/api/guides/properties)
- [Google Sheets RAW 입력과 append](https://developers.google.com/workspace/sheets/api/guides/values)
- [OAuth refresh token 만료 조건](https://developers.google.com/identity/protocols/oauth2#expiration)
