import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchedule, validateSchedule, scheduleFromGoogle, scheduleGoogleEvent, scheduleMinutes, scheduleGoogleId, scheduleImportedId, prepareSchedule, scheduleInWindow } from '../src/performanceScheduleDomain.mjs';
const sample = patch => normalizeSchedule({ id:'training-test',title:'수퍼비전 예약',date:'2026-09-23',endDate:'2026-09-23',start:'10:00',end:'11:00',allDay:false,place:'상담실',target:'kcp',itemId:'kcp-individual-supervision',...patch });
const remote = patch => ({id:'google123',etag:'"rev1"',status:'confirmed',summary:'공개사례발표회',location:'교육관',start:{dateTime:'2026-09-23T01:00:00Z'},end:{dateTime:'2026-09-23T03:00:00Z'},...patch});
test('schedule validates actual dates and exclusive all-day end; time never multiplies by attendance',()=>{
  assert.equal(validateSchedule(sample()),null);assert.equal(scheduleMinutes(sample()),60);
  assert.ok(validateSchedule(sample({date:'2026-02-30'})));
  assert.ok(validateSchedule(sample({end:'09:00'})));
  assert.equal(validateSchedule(sample({allDay:true,start:'',end:'',endDate:'2026-09-24'})),null);
  assert.ok(validateSchedule(sample({allDay:true,start:'',end:''})));
  assert.equal(scheduleMinutes(sample({date:'2026-09-23',start:'23:30',endDate:'2026-09-24',end:'00:30'})),60);
  assert.ok(validateSchedule(sample({target:'kca',itemId:'kcp-individual-supervision'})));
});
test('Google payload contains scheduling fields and category markers, never local approvals or supervisor notes',()=>{
  const result=scheduleGoogleEvent(sample({supervisorId:'sv1',supervisorName:'private supervisor',note:'private memo'}));
  assert.deepEqual(Object.keys(result).sort(),['end','extendedProperties','location','start','summary']);
  assert.equal(JSON.stringify(result).includes('private'),true); // only Google's private marker namespace
  assert.equal(JSON.stringify(result).includes('private supervisor'),false);
  assert.equal(JSON.stringify(result).includes('private memo'),false);
  assert.equal(result.start.dateTime,'2026-09-23T10:00:00+09:00');
});
test('remote reads normalize Seoul time and preserve completion and local supervisor classification',()=>{
  const previous=sample({status:'done',recordId:'training-record',approvalId:'training-approval',supervisorName:'saved',note:'private'});
  const result=scheduleFromGoogle(remote(),previous,'calendar1','unused');
  assert.equal(result.start,'10:00');assert.equal(result.end,'12:00');assert.equal(result.status,'done');
  assert.equal(result.recordId,'training-record');assert.equal(result.supervisorName,'saved');assert.equal(result.itemId,previous.itemId);
  const cancelled=scheduleFromGoogle({id:'google123',status:'cancelled'},result,'calendar1');
  assert.equal(cancelled.status,'done');assert.equal(cancelled.calendar.remoteCancelled,true);
  assert.equal(scheduleFromGoogle({id:'google123',status:'cancelled'},sample(),'calendar1').status,'cancelled');
});
test('external schedules need classification and malformed remote data cannot replace local data',()=>{
  const imported=scheduleFromGoogle(remote(),undefined,'calendar1','import123');
  assert.equal(imported.target,'');assert.equal(imported.itemId,'');assert.equal(imported.status,'planned');
  assert.throws(()=>scheduleFromGoogle(remote({end:{dateTime:'invalid'}}),sample(),'calendar1'));
  assert.throws(()=>scheduleFromGoogle(remote({etag:''}),sample(),'calendar1'));
  const unknown=scheduleFromGoogle(remote({extendedProperties:{private:{target:'kcp',itemId:'unrecognized'}}}),undefined,'calendar1','import123');
  assert.equal(unknown.target,'');
});
test('scheduling edits enroll writes but local notes and completion do not; imported identifiers are stable and separate',async()=>{
  const previous=sample({calendar:{calendarId:'cal1',state:'synced',revision:2}});
  assert.equal(prepareSchedule({...previous,note:'new note'},previous,'cal1').calendar.state,'synced');
  const changed=prepareSchedule({...previous,title:'시간 변경'},previous,'cal1');
  assert.equal(changed.calendar.state,'pending');assert.equal(changed.calendar.revision,3);
  assert.equal(await scheduleGoogleId('abc'),await scheduleGoogleId('abc'));
  assert.match(await scheduleGoogleId('abc'),/^a1[0-9a-f]{64}$/);
  assert.notEqual(await scheduleImportedId('cal1','event1'),await scheduleImportedId('cal2','event1'));
  assert.equal(scheduleInWindow(previous,'2026-09-01','2026-09-30'),true);
  assert.equal(scheduleInWindow(previous,'2026-10-01','2026-10-31'),false);
});
