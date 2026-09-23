// Transcribed from the four screenshots supplied by the user on 2026-09-23.
// This is an approval checklist, not an automatic qualification decision.
export const APPROVAL_SCHEMES = [
  {
    id: 'kcp', name: '한국상담심리학회', track: '상담심리사 2급',
    sourceNote: '사용자 제공 캡처 1의 자격심사 최소수련내용 기준입니다. 실제 인정 여부는 확인받은 항목에 직접 기록하며, 현행 규정이나 자격 충족을 자동 판정하지 않습니다.',
    sections: ['접수면접', '개인상담', '집단상담', '심리평가', '공개사례발표', '상담사례 연구활동'],
    omittedRequirements: ['집단상담 실시·수퍼비전과 학술 및 연구활동은 제공 표에서 “-”로 표시되어 별도 필수 수량을 설정하지 않았습니다.'],
  },
  {
    id: 'kca', name: '한국상담학회', track: '1급 · B범주 · 720시간 · 4년 이상',
    sourceNote: '사용자 제공 캡처 2~4 기준입니다. 720시간은 개인상담 590시간과 집단상담 130시간이며, 기타요건과 제출서류는 별도입니다. 연구실적의 네 번째 선택지는 화면 아래가 잘려 세부 조건을 확인해야 합니다.',
    sections: ['개인상담', '집단상담', '기타요건', '제출서류'],
    totalTrainingMinutes: 720 * 60, minimumYears: 4,
    sectionTrainingMinutes: { '개인상담': 590 * 60, '집단상담': 130 * 60 },
    sourceIncomplete: true,
  },
];

const measure = (id, label, unit, target) => ({ id, label, unit, target });
const cases = target => measure('cases', '사례', '사례', target);
const sessions = target => measure('sessions', '상담 회기', '회', target);
const times = (target, label = '횟수', unit = '회') => measure('times', label, unit, target);
const minutes = hours => measure('minutes', '수련 시간', '분', hours * 60);
const groups = target => measure('groups', '집단 수', '개', target);
const item = (id, scheme, section, label, measures, conditions, activityIds = [], extra = {}) => ({ id, scheme, section, label, measures, conditions, activityIds, ...extra });
const kcpTests = [
  '자격검정위원회가 인정하는 개인용 검사: MMPI, MMPI-A, SCT, HTP, BGT, KFD, TAT, CAT, Rorschach, K-WAIS, K-WISC, K-ABC, SCL-90-R, KSCL95.',
  '개인용 이외의 표준화 검사는 실시·채점·해석 과정이 표준화되고 공인 출판사에서 제작·판매하는 검사로, 신뢰도·타당도·규준·임상적 유용성을 바탕으로 판단합니다. 학회 Q&A와 자격증 취득 과정 매뉴얼의 목록을 확인합니다.',
  '한 검사가 전체 사례의 1/2을 초과할 수 없습니다. 검사실시·해석상담·수퍼비전에 모두 해당합니다.',
];
const kcaTests = [
  '상담기간 내 검사 실시·해석을 진행한 사례 중 2종 이상 검사를 활용한 5사례와 3종 이상을 활용한 10사례를 포함합니다. 이 중 동일검사는 최대 12건까지 인정 가능하며 인정검사를 20건 이상 포함합니다.',
  '인정검사: 웩슬러 지능검사(K-WAIS, WAIS-IV, WISC-IV, K-WPPSI), MMPI(MMPI-2, MMPI-A, MMPI-RF), PAI, CPI, KPI(KPI-C), K-ABC, BGT, HTP(KHTP), KFD, KSD, Rorschach, SCT, TAT.',
  '자격검정위원회 인정검사를 전체 검사 수의 50% 이상 포함해야 합니다. 기타 검사는 나머지 50% 이내에서 실시할 수 있습니다.',
  '한 검사는 전체 검사 수의 30%를 넘지 못합니다. 같은 계열의 검사는 한 검사로 간주합니다(예: MMPI-2와 MMPI-A를 각 2번 사용하면 MMPI 총 4번).',
  '기타 검사는 인정검사 외의 심리검사입니다. 표준화되거나 한국판으로 타당화된 검사를 권장하며 단순 척도·체크리스트·단순 그림검사는 지양합니다. 설문지·가계도는 심리검사로 인정되지 않습니다.',
];
const kcaSupervision = [
  '수퍼바이저는 한국상담학회 수련감독자여야 합니다.',
  '수퍼바이지는 1~3명까지 가능합니다. 2~3명일 때는 구성원 모두 각자의 상담사례를 준비하여 진행합니다.',
];
const kcaPresentation = [
  '수퍼바이저는 한국상담학회 수련감독자 2명이며, 전문영역 1명 이상이 필수입니다.',
  '주최기관은 교육연수기관·모학회·분과학회·지역학회입니다.',
  '발표 결과보고서(발표자료)를 제출합니다.',
];

export const APPROVAL_ITEMS = [
  item('kcp-intake', 'kcp', '접수면접', '상담 및 심리검사 접수면접', [times(20)], ['상담 및 심리검사 접수면접 20회 이상입니다.'], ['intake']),
  item('kcp-individual-counseling', 'kcp', '개인상담', '면접상담', [cases(5), sessions(50)], ['5사례, 합계 50회기 이상입니다.', '부부·가족·아동상담을 포함합니다.'], ['individual']),
  item('kcp-individual-supervision', 'kcp', '개인상담', '수퍼비전', [times(10)], ['10회 이상이며 공개사례발표 2회를 포함합니다.'], ['supervision']),
  item('kcp-group-participation', 'kcp', '집단상담', '참여', [groups(2), minutes(30)], ['2개 집단 이상에 참여합니다.', '집단별 최소 15시간이며 합계 30시간 이상입니다. 식사시간은 포함하지 않습니다.'], ['group']),
  item('kcp-test-administration', 'kcp', '심리평가', '검사실시', [cases(10)], ['10사례 이상입니다.', '1사례당 검사 2개 이상이며 그중 개인용 검사 1개를 포함합니다.', ...kcpTests], ['test']),
  item('kcp-test-interpretation', 'kcp', '심리평가', '해석상담', [cases(10)], ['10사례 이상입니다.', ...kcpTests], ['interpretation']),
  item('kcp-test-supervision', 'kcp', '심리평가', '수퍼비전', [cases(5)], ['5사례 이상입니다.', '1사례당 검사 2개 이상이며 그중 개인용 검사 1개를 포함합니다.', ...kcpTests], ['supervision']),
  item('kcp-public-presentation', 'kcp', '공개사례발표', '개인상담 공개사례발표', [cases(2), sessions(10)], ['본회·상담사례 토의모임에서 개인상담 2사례, 총 10회기 이상을 발표합니다.', '발표 간격은 3주 이상이어야 합니다.', '외국자격증 소지자로 자격시험 면제자는 개인상담 1사례, 총 10회기 이상입니다. 이 예외에 해당하면 개별 확인이 필요합니다.']),
  item('kcp-case-study-activity', 'kcp', '상담사례 연구활동', '학술행사 및 상담사례 토의모임 참여', [times(10)], ['학회 학술 및 사례 심포지엄(월례회) 2회 이상을 포함하여 본회·상담사례 토의모임에 총 10회 이상 참여합니다.']),

  item('kca-intake', 'kca', '개인상담', '접수면접', [minutes(20)], ['상담기관 직인 또는 수련감독자 서명으로 확인합니다.', '온라인 원격화상은 최대 10시간입니다.', '현장에서 직접 대면한 시간을 최소 10시간 포함합니다.'], ['intake'], { within720: true, onlineMaxMinutes: 10 * 60, faceMinMinutes: 10 * 60 }),
  item('kca-client-experience', 'kca', '개인상담', '내담자 경험', [minutes(30)], ['상담자는 한국상담학회 수련감독자여야 합니다.', '한 상담자에게 5시간 이상 지속한 시간만 인정됩니다.', '온라인 원격화상은 최대 15시간입니다.', '현장에서 직접 대면한 시간을 최소 15시간 포함합니다.'], [], { within720: true, onlineMaxMinutes: 15 * 60, faceMinMinutes: 15 * 60 }),
  item('kca-counselor-experience', 'kca', '개인상담', '상담자 경험', [minutes(420)], ['5회기 이상 지속된 5사례와 10회기 이상 지속된 10사례를 포함합니다.', '온라인 원격화상은 최대 240시간입니다.', '현장에서 직접 대면한 시간을 최소 180시간 포함합니다.', ...kcaTests], ['individual', 'test', 'interpretation'], { within720: true, onlineMaxMinutes: 240 * 60, faceMinMinutes: 180 * 60 }),
  item('kca-individual-supervision', 'kca', '개인상담', '수퍼비전', [minutes(70)], [...kcaSupervision, '본인 사례로 수퍼비전 받은 시간을 24시간 이상 포함합니다.', '심리검사에 관한 수퍼비전을 24시간 이상 포함합니다.', '온라인 원격화상은 최대 56시간입니다.', '현장에서 직접 대면한 시간을 최소 14시간 포함합니다.'], ['supervision'], { within720: true, onlineMaxMinutes: 56 * 60, faceMinMinutes: 14 * 60 }),
  item('kca-individual-report', 'kca', '개인상담', '사례보고서', [cases(1)], ['5회기 이상 지속된 사례여야 합니다.', '한 회기 전체 축어록을 포함하며 내용 일부 생략은 인정되지 않습니다.', '온라인 원격화상 제한은 없습니다.']),
  item('kca-individual-public-presentation', 'kca', '개인상담', '공개사례발표회 발표', [cases(2)], ['10회기 이상 지속한 사례를 발표합니다.', '한국상담학회 수련감독자에게 수퍼비전을 2시간 이상 이수한 사례여야 합니다.', ...kcaPresentation, '온라인 원격화상 제한은 없습니다.']),
  item('kca-public-presentation-attendance', 'kca', '개인상담', '공개사례발표회 참여', [minutes(50)], ['수퍼바이저는 한국상담학회 수련감독자 2명 이상이며, 전문영역 1명 이상이 필수입니다.', '주최기관은 교육연수기관·모학회·분과학회·지역학회입니다.', '온라인 원격화상 제한은 없습니다.'], [], { within720: true, onlineMaxMinutes: null }),
  item('kca-group-member-experience', 'kca', '집단상담', '집단원 경험', [minutes(70)], ['지도자는 한국상담학회 수련감독자여야 합니다.', '한 집단당 최소 10시간 이상입니다.', '2개 집단 이상을 포함합니다.', '온라인 원격화상은 최대 35시간입니다.', '현장에서 직접 대면한 시간을 최소 35시간 포함합니다.'], ['group'], { within720: true, onlineMaxMinutes: 35 * 60, faceMinMinutes: 35 * 60 }),
  item('kca-group-leader-experience', 'kca', '집단상담', '지도자 경험', [minutes(50)], ['한 집단당 최소 10시간 이상으로 구성합니다. 구조화·비구조화 집단 모두 가능합니다.', '주 지도자로 진행한 2사례, 총 30시간 이상을 포함합니다.', '나머지 20시간은 주 지도자 또는 보조 지도자 역할 모두 가능합니다. 보조 지도자 역할일 때 주 지도자는 한국상담학회 수련감독자여야 합니다.', '온라인 원격화상은 최대 25시간입니다.', '현장에서 직접 대면한 시간을 최소 25시간 포함합니다.'], ['group'], { within720: true, onlineMaxMinutes: 25 * 60, faceMinMinutes: 25 * 60 }),
  item('kca-group-supervision', 'kca', '집단상담', '수퍼비전', [minutes(10)], [...kcaSupervision, '본인 사례로 수퍼비전 받은 시간을 4시간 이상 포함합니다.', '온라인 원격화상은 최대 8시간입니다.'], ['supervision'], { within720: true, onlineMaxMinutes: 8 * 60 }),
  item('kca-group-report', 'kca', '집단상담', '사례보고서', [cases(1)], ['10시간 이상 지속한 사례여야 합니다.', '한 회기 전체 축어록을 포함하며 내용 일부 생략은 인정되지 않습니다.', '지도자 경험으로 제출합니다. 주·보조 지도자 및 구조화·비구조화 집단 모두 가능합니다.', '온라인 원격화상 제한은 없습니다.']),
  item('kca-group-public-presentation', 'kca', '집단상담', '공개사례발표회 발표', [cases(1)], ['주 지도자 역할로 10시간 이상 진행한 사례를 발표합니다.', '한국상담학회 수련감독자에게 수퍼비전을 2시간 이상 이수한 사례여야 합니다.', ...kcaPresentation, '온라인 원격화상 제한은 없습니다.']),
  item('kca-annual-conference', 'kca', '기타요건', '연차학술대회', [times(1)], ['한국상담학회(모학회) 주최 연차학술대회에 참석합니다.', '온라인 원격화상 제한은 없습니다.', '720시간 수련 합계와 별도로 관리합니다.']),
  item('kca-workshops', 'kca', '기타요건', '연수·학술모임', [minutes(80)], ['통합학술대회 및 사례발표회(모학회세션) 7회 이상을 포함합니다.', '분과학회 또는 지역학회 주최 연수회 2회 이상을 포함합니다.', '그 밖에 모학회 연수회와 교육연수기관에서 수련감독자가 진행한 교육이 적용됩니다.', '사례발표회는 제외합니다.', '온라인 원격화상 제한은 없습니다.', '720시간 수련 합계와 별도로 관리합니다.'], [], { within720: false, onlineMaxMinutes: null }),
  item('kca-research', 'kca', '기타요건', '연구실적 · 4종 중 택1', [times(1, '충족한 선택지', '종')], ['제공 표의 4종 중 1가지를 충족합니다. 다음 선택지는 서로 대안이며 논문·저서·발표를 모두 요구하지 않습니다.', '선택지 1: 등재후보지 이상 학술지(SSCI, SCI(E), A&HCI, SCOPUS 포함)에 게재한 상담 관련 논문 1편.', '선택지 2: 상담 관련 저·역서 1권. 별도 심의가 진행되며 연구보고서·사례 모음집·강의교재 묶음·수필 등은 불인정이라고 표기되어 있습니다.', '선택지 3: 한국상담학회 주최 연차학술대회 논문발표(구두 또는 포스터) 1회.', '선택지 4는 화면 아래가 잘려 일부만 보입니다. “KCA-IC 국제학술대회 논문발표(포스터) 1회” 문구가 보이며 뒤의 적용 조건은 원문 추가 확인이 필요합니다.', '온라인 원격화상 제한은 없습니다. 720시간 수련 합계와 별도로 관리합니다.'], [], { sourceIncomplete: true }),
  item('kca-document-training-log', 'kca', '제출서류', '수련기록부', [times(1, '제출 부수', '부')], ['수련기록부 1부를 제출합니다. 수련 시간에 더하지 않는 서류 확인 항목입니다.']),
  item('kca-document-individual-presentations', 'kca', '제출서류', '개인상담 공개사례발표회 결과보고서', [times(2, '제출 부수', '부')], ['개인상담 공개사례발표회 결과보고서 2부를 제출합니다. 발표 실적과 별도의 서류 확인 항목입니다.']),
  item('kca-document-group-presentation', 'kca', '제출서류', '집단상담 공개사례발표회 결과보고서', [times(1, '제출 부수', '부')], ['집단상담 공개사례발표회 결과보고서 1부를 제출합니다. 발표 실적과 별도의 서류 확인 항목입니다.']),
  item('kca-document-individual-report', 'kca', '제출서류', '개인상담 사례보고서', [times(1, '제출 부수', '부')], ['개인상담 사례보고서 1부를 제출합니다. 사례 실적과 별도의 서류 확인 항목입니다.']),
  item('kca-document-group-report', 'kca', '제출서류', '집단상담 사례보고서', [times(1, '제출 부수', '부')], ['집단상담 사례보고서 1부를 제출합니다. 사례 실적과 별도의 서류 확인 항목입니다.']),
  item('kca-document-research', 'kca', '제출서류', '연구실적 증빙', [times(1, '제출 부수', '부')], ['원문 제출서류 목록에는 연구실적(학술지, 저·역서) 1부로 표기되어 있습니다. 연구 선택지별 제출물은 별도로 확인합니다.']),
];

export const findApprovalItem = id => APPROVAL_ITEMS.find(entry => entry.id === id);
