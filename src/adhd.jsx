import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowLeft, ArrowRight, Check, ClipboardList, LockKeyhole, RotateCcw, Printer, ExternalLink } from "lucide-react";
import { ADHD_ITEMS, RESPONSE_LABELS, ADHD_INSTRUCTIONS, ASRS_ATTRIBUTION, ASRS_PUBLICATION, ASRS_SOURCES, scoreAdhd } from "./adhdDomain.mjs";

function AdhdAssessment() {
  const [stage, setStage] = useState("intro");
  const [adult, setAdult] = useState(false);
  const [answers, setAnswers] = useState(() => Array(6).fill(null));
  const [current, setCurrent] = useState(0);
  const [error, setError] = useState("");
  const [resetConfirm, setResetConfirm] = useState(false);
  const heading = useRef(null);
  const resetTrigger = useRef(null);
  const resetCancel = useRef(null);
  const completed = answers.filter((v) => v !== null).length;
  const result = scoreAdhd(answers);
  useEffect(() => { heading.current?.focus(); }, [stage, current]);
  useEffect(() => { if (resetConfirm) resetCancel.current?.focus(); }, [resetConfirm]);

  function start() {
    if (!adult) { setError("만 18세 이상인지 확인해 주세요."); return; }
    setError(""); setStage("questions");
  }
  function next() {
    if (answers[current] === null) { setError("가장 가까운 응답을 하나 선택해 주세요."); return; }
    setError("");
    if (current < 5) setCurrent(current + 1);
    else if (result) setStage("result");
  }
  function reset() {
    setAnswers(Array(6).fill(null)); setCurrent(0); setStage("intro");
    setAdult(false); setError(""); setResetConfirm(false);
  }

  return <div className="adhd-shell">
    <header className="adhd-header">
      <a className="adhd-brand" href="./adhd.html" aria-label="ADHD 자가 평가 처음으로"><span className="adhd-brand-icon"><ClipboardList size={22} /></span><span>마음 살피기 <span className="adhd-brand-sub">ADHD 자가 평가</span></span></a>
      <span className="adhd-tag">성인 · ASRS v1.1</span>
    </header>
    <main className="adhd-main">
      <div className="adhd-intro-line"><span className="adhd-eyebrow">나의 일상을 돌아보는 시간</span><span className="adhd-private"><LockKeyhole size={14} /> 응답 저장·전송 없음</span></div>
      <div className="adhd-layout">
        <aside className="adhd-aside" aria-label="평가 안내">
          <h1>성인 ADHD <br />자가 평가</h1>
          <p>주의력과 활동성에 관한<br className="adhd-desktop-break" /> 최근의 경험을 살펴보세요.</p>
          <div className="adhd-facts"><span><strong>6</strong>문항</span><span><strong>약 2</strong>분</span><span><strong>18</strong>세 이상</span></div>
          <ol className="adhd-stages">
            {[["intro", "시작 전 확인"], ["questions", "최근 6개월 돌아보기"], ["result", "결과 살펴보기"]].map(([key, label], i) => <li key={key} aria-current={stage === key ? "step" : undefined} className={stage === key ? "is-current" : ""}><span>{i + 1}</span>{label}</li>)}
          </ol>
          <div className="adhd-aside-note">이 평가는 진단을 대신하지 않습니다. 결과는 전문가와 상담할 때 참고 자료로 활용해 주세요.</div>
        </aside>

        <section className="adhd-card" aria-label="자가 평가">
          {stage === "intro" && <>
            <span className="adhd-kicker">시작 전 확인</span>
            <h2 ref={heading} tabIndex={-1}>최근 6개월의 나를<br />기준으로 답해 주세요.</h2>
            <p className="adhd-lead">각 문항에서 가장 가까운 빈도를 선택합니다. 정답은 없으며, 제출 전까지 응답을 바꿀 수 있습니다.</p>
            <div className="adhd-info"><strong>ASRS v1.1 · 한국어판 Part A</strong><p>성인의 ADHD 관련 증상을 살펴보는 6문항 선별검사입니다. 문항별 기준에 해당하는 응답이 4개 이상이면 전문가의 추가 평가를 권합니다.</p></div>
            <label className="adhd-consent"><input type="checkbox" checked={adult} onChange={(e) => { setAdult(e.target.checked); setError(""); }} /><span>저는 <strong>만 18세 이상</strong>이며, 이 결과가 ADHD 진단이 아니라는 점을 이해했습니다.</span></label>
            {error && <p className="adhd-error" role="alert">{error}</p>}
            <button className="adhd-primary adhd-start" onClick={start}>6문항 시작하기 <ArrowRight size={19} /></button>
            <p className="adhd-caption">이름이나 연락처를 입력하지 않습니다.<br />페이지를 새로고침하거나 닫으면 응답이 사라집니다.</p>
          </>}

          {stage === "questions" && <>
            <div className="adhd-question-top"><span className="adhd-kicker">최근 6개월을 생각해 주세요</span><span className="adhd-count">{current + 1}<span> / 6</span></span></div>
            <progress className="adhd-progress" value={completed} max={6} aria-label="응답한 문항 수">{completed}/6</progress>
            <div className="adhd-question-title" ref={heading} tabIndex={-1}><span className="adhd-question-number">문항 {current + 1}</span><h2 id="adhd-question">{ADHD_ITEMS[current].text}</h2></div>
            <fieldset className="adhd-options" aria-labelledby="adhd-question" aria-describedby="adhd-period">
              <legend className="adhd-sr-only">가장 가까운 빈도를 하나 선택해 주세요</legend>
              <p id="adhd-period" className="adhd-option-hint">지난 6개월 동안 얼마나 자주 그랬나요?</p>
              {RESPONSE_LABELS.map((label, value) => <label key={`${current}-${value}`} className={`adhd-option ${value >= ADHD_ITEMS[current].threshold ? "is-threshold" : ""} ${answers[current] === value ? "is-selected" : ""}`}>
                <input type="radio" name={`question-${current}`} value={value} checked={answers[current] === value} onChange={() => { setAnswers((prev) => prev.map((v, i) => i === current ? value : v)); setError(""); }} />
                <span>{label}</span><span className="adhd-option-check" aria-hidden="true">{answers[current] === value && <Check size={16} />}</span>
              </label>)}
            </fieldset>
            {error && <p className="adhd-error" role="alert">{error}</p>}
            <div className="adhd-actions">
              <button className="adhd-secondary" onClick={() => { setError(""); current === 0 ? setStage("intro") : setCurrent(current - 1); }}><ArrowLeft size={17} />이전</button>
              <span className="adhd-answered" aria-live="polite">{completed}개 응답</span>
              <button className="adhd-primary" onClick={next}>{current === 5 ? "결과 보기" : "다음 문항"}<ArrowRight size={17} /></button>
            </div>
            <details className="adhd-instructions"><summary>원문 검사 지침 보기</summary><p>{ADHD_INSTRUCTIONS}</p><p>종이 검사지의 X표 대신 응답을 선택해 주세요. 원문에서 기준에 해당하는 응답 칸의 음영을 옮겼습니다.</p></details>
          </>}

          {stage === "result" && result && <>
            <span className="adhd-kicker">자가 평가 결과</span>
            <h2 ref={heading} tabIndex={-1}>{result.needsFollowUp ? "전문가와 더 자세히\n살펴보세요." : "이번 응답은 선별 기준에\n해당하지 않습니다."}</h2>
            <div className={`adhd-result ${result.needsFollowUp ? "needs-follow-up" : ""}`}>
              <div><span>문항별 기준에 해당하는 응답</span><strong>{result.positiveCount}<small> / 6개</small></strong></div>
              <div className="adhd-result-bars" aria-hidden="true">{ADHD_ITEMS.map((item, i) => <span key={item.id} className={result.positiveItems[i] ? "is-positive" : ""} />)}</div>
              <p>6개 중 <strong>4개 이상</strong>이면 추가 평가를 권하는 선별 기준입니다. 이 수치는 ADHD 확률이나 증상의 심각도를 뜻하지 않습니다.</p>
            </div>
            <div className="adhd-result-advice"><h3>{result.needsFollowUp ? "다음으로 할 수 있는 일" : "불편함이 계속된다면"}</h3><p>{result.needsFollowUp ? "정신건강의학과 등에서 전문 평가를 받아보세요. 일·학업·관계에서 겪는 어려움과 어린 시절부터의 경험을 함께 이야기하면 도움이 됩니다." : "기준 미만이어도 ADHD가 없다고 단정할 수 없습니다. 집중이나 충동 조절의 어려움이 일상에 영향을 준다면 전문가와 상담해 보세요."}</p><p>수면 부족, 불안, 우울 등도 비슷한 어려움과 관련될 수 있습니다. 진단은 면담과 생활 전반의 정보를 종합해 이루어집니다.</p></div>
            <details className="adhd-review" open><summary>내 응답 확인하기</summary><p className="adhd-caption adhd-review-key">‘기준 해당’은 각 문항의 빈도 기준을 충족한 응답입니다.</p><ol>{ADHD_ITEMS.map((item, i) => <li key={item.id}><span className="adhd-review-number">{i + 1}</span><div><p>{item.text}</p><div className="adhd-review-answer"><strong>{RESPONSE_LABELS[answers[i]]}</strong>{result.positiveItems[i] && <span>기준 해당</span>}<button className="adhd-text-button adhd-no-print" aria-label={`${i + 1}번 응답 수정`} onClick={() => { setCurrent(i); setStage("questions"); setError(""); }}>수정</button></div></div></li>)}</ol></details>
            <div className="adhd-actions adhd-no-print"><button ref={resetTrigger} className="adhd-secondary" onClick={() => setResetConfirm(true)}><RotateCcw size={16} />다시 평가하기</button><button className="adhd-primary" onClick={() => window.print()}><Printer size={17} />결과 인쇄</button></div>
            {resetConfirm && <div className="adhd-reset adhd-no-print" role="group" aria-label="응답 초기화 확인"><p>현재 응답을 지우고 처음부터 시작할까요?</p><button ref={resetCancel} className="adhd-secondary" onClick={() => { setResetConfirm(false); resetTrigger.current?.focus(); }}>취소</button><button className="adhd-primary" onClick={reset}>응답 지우고 시작</button></div>}
            <p className="adhd-caption">응답은 자동 저장되지 않습니다. 보관하려면 인쇄 화면에서 PDF로 저장할 수 있습니다.</p>
          </>}
        </section>
      </div>
      <footer className="adhd-footer">
        <details><summary>검사 출처와 이용 안내</summary><p>한국어판 ASRS v1.1의 Part A 6문항을 사용합니다. 1~3번은 세 번째 응답 이상, 4~6번은 네 번째 응답 이상을 기준 해당으로 셉니다. 18문항 전체 검사나 ASRS-5의 채점과 다릅니다.</p><p>{ASRS_ATTRIBUTION}</p><p>한국어판 원문 표기: © World Health Organization 2003. All rights reserved.</p><p>{ASRS_PUBLICATION}</p><div className="adhd-source-links"><a href={ASRS_SOURCES.korean} target="_blank" rel="noreferrer">한국어판 원문 <ExternalLink size={12} /></a><a href={ASRS_SOURCES.license} target="_blank" rel="noreferrer">도구·사용 조건 <ExternalLink size={12} /></a><a href={ASRS_SOURCES.scoring} target="_blank" rel="noreferrer">채점 기준 <ExternalLink size={12} /></a><a href={ASRS_SOURCES.publication} target="_blank" rel="noreferrer">개발 논문 <ExternalLink size={12} /></a></div></details>
        <p>만 18세 이상을 위한 선별검사 · 진단 및 치료 결정을 대신하지 않습니다.</p>
      </footer>
    </main>
  </div>;
}

createRoot(document.getElementById("root")).render(<AdhdAssessment />);
