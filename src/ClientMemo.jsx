import React, { useId, useState } from "react";
import { Check, Pencil } from "lucide-react";

export default function ClientMemo({ client, onSave, ui }) {
  const { C, Btn, FONT } = ui;
  const savedMemo = typeof client.memo === "string" ? client.memo : "";
  const [draft, setDraft] = useState(savedMemo);
  const [editing, setEditing] = useState(!savedMemo.trim());
  const [error, setError] = useState("");
  const inputId = useId();
  const save = () => {
    if (onSave({ id: client.id, memo: draft.trim() }) === false) {
      setError("메모를 저장하지 못했습니다. 다시 저장해 주세요.");
      return;
    }
    setError("");
    setEditing(false);
  };
  return <section aria-label="내담자 메모" style={{ marginTop: 14, paddingTop: 13, borderTop: `1px solid ${C.rule}` }}>
    <div className="flex items-center justify-between gap-2" style={{ marginBottom: 8 }}>
      <label htmlFor={editing ? inputId : undefined} style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>내담자 메모</label>
      <div className="flex items-center gap-1.5">
        {editing ? <>
          <Btn size="sm" onClick={() => { setDraft(savedMemo); setError(""); setEditing(false); }}>취소</Btn>
          <Btn size="sm" kind="solid" icon={Check} onClick={save}>저장</Btn>
        </> : <Btn size="sm" icon={Pencil} onClick={() => { setDraft(savedMemo); setError(""); setEditing(true); }}>수정</Btn>}
      </div>
    </div>
    {editing ? <textarea id={inputId} aria-label={`${client.name || "내담자"} 메모 내용`} value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} rows={3}
      placeholder="이 내담자에게 참고할 내용을 적어 두세요."
      style={{ width: "100%", minWidth: 0, padding: "10px 11px", resize: "vertical", border: `1px solid ${C.rule}`, borderRadius: 9, background: C.surface, color: C.ink, fontFamily: FONT, fontSize: 12.5, lineHeight: 1.7 }} />
      : <div style={{ minHeight: 28, fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: savedMemo ? C.ink : C.faint }}>{savedMemo || "저장된 메모가 없습니다."}</div>}
    {error && <div role="alert" style={{ marginTop: 6, color: C.seal, fontSize: 11.5 }}>{error}</div>}
  </section>;
}
