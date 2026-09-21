# 성인 ADHD 자가 평가

온라인 직접 주소: https://workboard-beta.vercel.app/adhd.html

업무보드의 **상담 → 성인 ADHD 자가 평가**에서도 새 창으로 열 수 있습니다. 만 18세 이상을 대상으로, 한국어판 ASRS v1.1 Part A의 6문항에 최근 6개월을 기준으로 응답합니다. 이름·연락처를 받지 않으며 응답은 React 메모리에만 존재합니다. 새로고침·페이지 종료·초기화 시 사라지고, 결과 화면에서 인쇄 또는 브라우저의 PDF 저장 기능을 사용할 수 있습니다.

## 도구와 해석

- 1~3번: 세 번째 응답인 ‘약간 혹은 가끔 그렇다’ 이상이면 기준 해당.
- 4~6번: 네 번째 응답인 ‘자주 그렇다’ 이상이면 기준 해당.
- 기준 해당이 4개 이상이면 전문가의 추가 평가 권고. 4개 미만이어도 ADHD를 배제하지 않습니다.
- 결과는 0~6개 해당 문항 수이며, 진단·확률·중증도·18문항 총점으로 해석하지 않습니다.
- 6문항을 모두 응답해야 결과를 표시합니다. 누락·범위 밖 응답·문자열·희소 배열은 채점하지 않습니다.

공식 한국어 문항과 보기, 원문의 문장부호, 기준 칸 음영을 유지했습니다. 종이 검사지의 X 표시는 라디오 선택으로 구현했습니다. 문항의 현재 권리자 출처 표기와 한국어 원문의 WHO 표기를 화면에 함께 제공합니다.

## 근거 및 사용 조건

- [Harvard 한국어판 원문](https://www.hcp.med.harvard.edu/ncs//ftpdir/adhd/adhd/Old%20Versions/18Q-Korean.pdf): Part A 6문항과 5단계 응답.
- [NYU 공식 6문항 도구 및 사용 조건](https://license.tov.med.nyu.edu/product/asrs6Qscreener): 18세 이상, 출처 표기 조건으로 임상·비임상·상업 사용 무료, 전자 버전 제작 허용. 전자화 이외의 문항 수정은 허용하지 않음.
- [공식 6문항 채점 안내](https://www.hcp.med.harvard.edu/ncs//ftpdir/adhd/adhd/Old%20Versions/6Question-ADHD-ASRS-v1-1.pdf).
- [개발 논문](https://pubmed.ncbi.nlm.nih.gov/15841682/): Kessler et al., Psychological Medicine (2005), 35(2), 245–256.

## 구현과 확인

- `src/adhdDomain.mjs`: 문항·원문·출처·순수 채점 함수.
- `src/adhd.jsx`, `src/adhd.css`: 독립된 평가 화면, 응답 수정·초기화·인쇄.
- `scripts/build.js`: 업무보드와 별도 번들인 `dist/adhd.html` 생성. 업무보드 상태·내담자 데이터·캘린더 연동을 불러오지 않습니다.
- `public/sw.js`: 업무보드의 오프라인 자산에 평가 페이지 포함. 평가 경로의 네트워크 실패 시 평가 페이지만 사용하며 업무보드로 대체하지 않습니다.
- `tests/adhdDomain.test.mjs`: 미응답·잘못된 값·문항별 역치·3/4개 경계 검증.

기존 데이터 형식, 저장 키, Google 동기화 설정은 변경하지 않습니다. 평가 페이지에는 서버 API 호출, 분석 추적 코드, 쿠키·웹 저장소 쓰기가 없습니다. 결과 인쇄 시 생성한 파일은 사용자가 직접 보관합니다.
