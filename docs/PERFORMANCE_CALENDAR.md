# 수련 전용 Google 캘린더

실적 관리 프로그램은 기존 상담·센터 캘린더와 별도로 `상담·수련 실적` 달력을 연결한다. 처음 승인하면 본인 소유의 전용 달력을 찾고, 없을 때만 하나를 만든다. 서버는 Google 기본 달력이나 다른 달력의 일정을 수정하지 않는다. 캘린더 설명의 식별자는 `workboard:counseling-training:v1`이며, 서버가 생성할 때 시간대는 `Asia/Seoul`이다. 공유 권한(ACL)을 생성하거나 변경하지 않으며, 새 보조 캘린더는 Google의 기본 비공개 설정을 유지한다.

## 연결과 권한

기존 서버 환경변수 `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_SESSION_KEY`, `GOOGLE_CALENDAR_ORIGINS`를 재사용한다. 선택적인 연결 비밀번호는 `PERFORMANCE_CONNECTION_PASSWORD`, 없으면 `WORKBOARD_CONNECTION_PASSWORD`를 사용한다. 비밀번호를 설정하지 않은 경우 명시적인 Google 계정 승인이 연결 절차다.

수련 캘린더용 OAuth 요청 범위는 다음 두 가지로 한정한다.

- `https://www.googleapis.com/auth/calendar.app.created`: 이 앱이 생성한 보조 달력 및 해당 일정 관리.
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`: 이전에 만든 수련 달력을 다시 찾기 위한 캘린더 목록 읽기.

`calendar.app.created`만으로는 CalendarList 목록을 조회할 수 없으므로 목록 읽기 범위를 함께 요청한다. `calendar`, `calendar.events`, Drive·Sheets 전체 접근 범위는 이 연결에서 요청하지 않는다. 자세한 권한 근거는 [CalendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [Calendars.insert](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert), [Events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch) 공식 문서에 있다.

연결 시작 시 10분짜리 인증 교환 허가 쿠키를 발급하고, GIS 팝업의 일회성 코드를 서버에서 교환한다. `redirect_uri`는 현재 승인된 origin이다. 갱신 토큰은 AES-256-GCM으로 암호화한 HttpOnly·SameSite=Lax 쿠키에 보관한다. HTTPS에서는 Secure·`__Host-`를 적용한다. 쿠키 이름은 `wb_performance_calendar_session`과 `wb_performance_calendar_grant`이며 기존 상담 캘린더·시트 쿠키와 분리한다. 토큰·비밀번호·클라이언트 비밀키는 응답과 로그에 노출하지 않는다.

서버 인스턴스가 바뀌어도 암호화 쿠키의 갱신 토큰으로 연결을 복원한다. 서버 메모리에 캐시한 액세스 토큰이 만료되거나 거절되면 갱신한다. Google 계정의 동의 취소나 OAuth 앱의 운영 정책 등으로 갱신 권한이 만료된 경우에는 화면에서 다시 연결해야 한다.

## 전용 달력 식별

연결할 때 소유자 캘린더 목록의 모든 페이지를 읽는다. 부분 응답, 읽기 실패, 중복·반복 페이지는 실패로 처리하며 빈 목록으로 대신하지 않는다. 기존 바인딩 ID가 전달되면 그 달력만 재사용한다. 바인딩된 달력이 사라졌거나 식별자가 다른 경우 새 달력을 만들지 않는다. 전용 식별자가 있는 달력이 여러 개인 경우에도 임의 선택하거나 새로 만들지 않는다.

Google의 [Calendars and events](https://developers.google.com/workspace/calendar/api/concepts/events-calendars) 문서는 `Calendars.insert`로 생성한 보조 달력이 생성자의 CalendarList에도 추가된다고 명시한다. 생성 뒤 바로 [CalendarList.get](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/get)으로 소유권과 식별자를 확인한다. 이 조회가 실패하면 연결 완료로 처리하지 않는다. 별도의 CalendarList 쓰기 권한이나 목록 삽입 작업은 필요하지 않다.

연결 후 상태·조회·수정·삭제 요청마다 Google CalendarList의 해당 달력 정보를 다시 읽어 소유자 접근권한과 설명 식별자를 확인한다. 클라이언트가 보낸 수정 대상 달력 ID는 암호화 세션의 바인딩과 같아야 한다. 새 달력 생성은 Google API에 동일 ID를 지정할 수 없는 작업이므로, 서로 다른 서버 인스턴스에서 최초 연결을 정확히 동시에 완료하면 중복 생성 가능성이 있다. 이후에는 복수 식별자 탐지로 처리를 중단하며 임의 달력을 고르지 않는다.

## 일정 동기화의 경계

조회 범위는 서울 시간 기준 시작일과 종료일을 포함하며 최대 400일이다. Google 요청에는 시작일 00:00과 종료일 다음 날 00:00을 전달한다. `singleEvents=true`로 반복 일정을 회차별로 받고 `showDeleted=true`로 취소된 회차도 확인한다. 모든 페이지가 정상적으로 끝난 경우에만 결과를 반환한다.

서버에서 전달하는 일정 필드는 ID·상태·ETag·제목·장소·시작·종료·연결용 private 속성·반복 회차 식별자·원래 시작 시간·갱신 시간·Google 일정 링크로 한정한다. Google에 저장하는 필드는 제목·장소·시작·종료와 연결용 private 속성(`trainingScheduleId`, `target`, `itemId`)뿐이다. 상담 메모·내담자 정보·참석자·첨부파일을 전송하지 않는다. Google에서 직접 추가한 다른 필드를 PATCH로 덮어쓰지 않는다. 캘린더 목록에서 조회되지 않았다는 이유만으로 로컬 실적이나 일정을 삭제하지 않는다.

새 일정 ID는 로컬 일정 ID에 대한 `a1 + SHA-256("workboard:training:" + localId)`로 고정한다. 저장 응답을 잃어도 같은 ID로 확인하므로 재시도로 새 일정을 추가하지 않는다. 같은 ID의 원격 내용이 다르면 기존 원격 내용을 돌려주고 충돌을 표시한다.

시간이 있는 일정의 저장 확인은 문자열 모양이 아니라 UTC 시각으로 비교한다. 따라서 Google이 `+09:00`을 `Z`로 바꾸거나 밀리초·시간대 표시를 정규화해도 같은 시각이면 정상 저장으로 확인한다. 종일 일정은 날짜 자체를 비교하며 시간대 필드는 의미가 없으므로 정규화할 때 제거한다.

기존 일정 수정·삭제에는 최신 ETag가 필요하다. 수정 전 조회 결과를 비교하고 Google 요청에도 `If-Match`를 보낸다. 충돌이 발견되면 HTTP 409 `calendar_conflict`와 현재 원격 일정을 반환한다. 원격 내용과 로컬 대기 변경을 조용히 덮어쓰지 않는다. 반복 일정의 전체 시리즈는 이 API에서 수정·삭제하지 않고 선택한 회차만 처리한다. 종일 일정의 종료일은 Google 표준에 따라 마지막 날의 다음 날이다.

## API 계약

경로는 `/api/performance-calendar`다. JSON POST는 `action`을 본문에 담고, GET은 쿼리에 담는다. 선택적으로 POST 쿼리에도 `action`을 줄 수 있으나 본문과 같아야 한다. 모든 구성된 요청에는 `X-Workboard-Performance-Calendar: 1`과 같은 origin이 필요하다. 브라우저 GET에서 Origin을 보내지 않는 경우 같은 origin의 Referer를 확인한다. 요청 본문 크기는 최대 32 KiB다.

| 요청 | 응답 핵심 |
|---|---|
| GET `action=status` | `{ configured, connected, passwordRequired, clientId, scope, calendar }` |
| POST `connect`, 선택 `password` | 팝업 설정, 인증 교환 허가 쿠키 |
| POST `exchange`, `code`, 선택 `calendarId` | `{ connected:true, calendar }`, 암호화 세션 쿠키 |
| GET `action=list&from=YYYY-MM-DD&to=YYYY-MM-DD` | `{ calendarId, from, to, items }` |
| GET `action=event&eventId=...` | `{ calendarId, event }`; 명시적인 404·410일 때 `event:null` |
| POST `upsert`, `calendarId`, `localId`, `event`, 선택 `eventId`, `etag` | `{ calendarId, event }`; 수정은 `eventId`와 `etag` 모두 필요 |
| POST `delete`, `calendarId`, `eventId`, `etag` | `{ calendarId, deleted:true, eventId }` |
| POST `disconnect` | 해당 수련 캘린더 쿠키만 삭제; Google 달력·일정은 유지 |

`calendar`는 `{ id, name, url }`이다. 일반 오류는 `{ error:{ code, message, retryable } }`이며, 충돌 오류에는 최상위 `remote`가 현재 일정 또는 삭제된 경우 `null`로 추가된다. 오류 응답은 Google 원문 오류나 인증 정보를 포함하지 않는다.

## 검증

`tests/performanceCalendar.test.mjs`는 외부 계정이나 실제 데이터를 사용하지 않는 Google API 모의 응답으로 검증한다. 전용 달력 생성·재연결, 여러 페이지 조회, 미완성 응답 방어, origin·쿠키·권한 검증, 고정 ID 재시도, ETag 충돌, 종일 날짜, 반복 회차, 별도 쿠키 해제를 포함한다. 실제 Google 계정에서의 OAuth 승인·달력 생성·양방향 동기화는 별도 연결 후 확인할 수 있다.
