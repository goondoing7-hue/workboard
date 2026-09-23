/* Optional asset authoring: node scripts/generate-performance-brand.cjs <sharp module path>
   Public PNGs are committed, so ordinary builds need no image-rendering dependency. */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const root = path.resolve(__dirname, '..');
const target = name => path.join(root, 'public', name);
const icon = fs.readFileSync(target('performance-icon.svg'), 'utf8');
const mark = icon.replace(/<svg[^>]*>/, '').replace('</svg>', '');
const share = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#E9F1FF"/><stop offset="1" stop-color="#DCE8FF"/></linearGradient>
  <filter id="shadow" x="-25%" y="-25%" width="150%" height="170%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#163877" flood-opacity=".1"/></filter>
</defs>
<rect width="1200" height="630" fill="#F7F9FD"/>
<rect x="814" width="386" height="630" fill="url(#panel)"/>
<path d="M814 0v630" stroke="#D8E4F7"/>
<g transform="translate(68 61) scale(.75)">${mark}</g>
<text x="133" y="94" fill="#42618A" font-family="Malgun Gothic, sans-serif" font-size="24" font-weight="700">기록과 수련 관리</text>
<text x="64" y="255" fill="#13283F" font-family="Malgun Gothic, sans-serif" font-size="70" font-weight="700" letter-spacing="-4">상담 실적 관리</text>
<text x="69" y="327" fill="#607187" font-family="Malgun Gothic, sans-serif" font-size="29" letter-spacing="-1">상담 기록부터 인정받은 실적까지,</text>
<text x="69" y="373" fill="#607187" font-family="Malgun Gothic, sans-serif" font-size="29" letter-spacing="-1">한곳에서 차근차근 관리하세요.</text>
<g font-family="Malgun Gothic, sans-serif" font-size="21" font-weight="700" fill="#2D527B">
  <rect x="69" y="432" width="137" height="46" rx="23" fill="#EAF0FA"/><text x="137.5" y="462" text-anchor="middle">상담 기록</text>
  <rect x="218" y="432" width="137" height="46" rx="23" fill="#EAF0FA"/><text x="286.5" y="462" text-anchor="middle">승인 현황</text>
  <rect x="367" y="432" width="137" height="46" rx="23" fill="#EAF0FA"/><text x="435.5" y="462" text-anchor="middle">수련 일정</text>
</g>
<g filter="url(#shadow)"><rect x="865" y="208" width="274" height="238" rx="29" fill="#FFF"/></g>
<path d="M892 261h220" stroke="#E8EEF8" stroke-width="2"/>
<circle cx="894" cy="236" r="5" fill="#B9CDF0"/><circle cx="912" cy="236" r="5" fill="#B9CDF0"/><circle cx="930" cy="236" r="5" fill="#B9CDF0"/>
<g transform="translate(934 279) scale(2.2)">${mark}</g>
<rect x="845" y="158" width="79" height="79" rx="22" fill="#2464E8"/>
<path d="m867 197 12 12 24-25" fill="none" stroke="#FFF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
<g fill="#88ADEB"><circle cx="1130" cy="160" r="7"/><circle cx="876" cy="480" r="5"/><circle cx="1144" cy="487" r="9"/></g>
<text x="70" y="565" fill="#8795A8" font-family="Malgun Gothic, sans-serif" font-size="18">COUNSELING · RECORDS &amp; TRAINING</text>
</svg>`;
(async () => {
  for (const size of [32, 192]) {
    await sharp(Buffer.from(icon)).resize(size, size).png().toFile(target(`performance-icon-${size}.png`));
  }
  await sharp(Buffer.from(share)).png().toFile(target('performance-share-v1.png'));
  console.log('Created dedicated performance icons and 1200×630 sharing image.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
