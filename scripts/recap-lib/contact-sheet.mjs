// One HTML page per show: every frame's image and text side by side, plus the
// audit trail, for a two-minute human skim before upload.
//
// This step is not decoration. Every serious defect the first library shipped
// — a wrong actor, a spine describing a different series, a character
// attributed to her father — was found by a person looking at a slide, and
// none tripped an automated check, because all were correctly SHAPED. The
// deterministic gates catch structure; this catches the rest.

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WORK } from './env.mjs';

const esc = s =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function frameCard(kind, image, dim, title, body, meta = '') {
  return `<div class="frame">
    <div class="art" style="background-image:url('${esc(image)}')"><div class="scrim" style="opacity:${dim}"></div>
      <div class="copy"><div class="kind">${esc(kind)}</div><div class="title">${esc(title)}</div><div class="body">${esc(body)}</div></div>
    </div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
  </div>`;
}

export async function writeContactSheet(show, seasons, verifyReport = {}) {
  const sections = seasons
    .map(s => {
      const flags = verifyReport[s.season]?.flags ?? [];
      const skipped = verifyReport[s.season]?.skipped;
      const frames = [
        ...s.characters.map(c =>
          frameCard('character', c.image, c.dim, c.name, c.line, esc(c.actor || '⚠ no actor matched')),
        ),
        ...s.beats.map(b => frameCard('beat', b.image, b.dim, b.label, b.text)),
        ...(s.cliffhanger
          ? [
              frameCard(
                'cliffhanger',
                s.cliffhanger.image,
                s.cliffhanger.dim,
                'Where you left off',
                s.cliffhanger.text,
                (s.cliffhanger.questions ?? []).map(esc).join('<br>'),
              ),
            ]
          : []),
      ].join('\n');

      const audit = skipped
        ? `<p class="audit skip">audit skipped: ${esc(skipped)}</p>`
        : flags.length
          ? `<div class="audit"><strong>${flags.length} audit flag(s) outstanding</strong><ul>${flags
              .map(f => `<li class="${esc(f.severity)}">[${esc(f.severity)}] ${esc(f.id)} ${esc(f.type)}: ${esc(f.claim)}<br><em>${esc(f.evidence ?? '')}</em></li>`)
              .join('')}</ul></div>`
          : `<p class="audit ok">audit clean${verifyReport[s.season]?.rounds ? ` after ${verifyReport[s.season].rounds} repair round(s)` : ''}</p>`;

      return `<section><h2>Season ${s.season} <span>· ${s.episode_count ?? '?'} episodes · ${s.beats.length} beats · ${s.characters.length} characters</span></h2>
      ${audit}
      <div class="grid">${frames}</div></section>`;
    })
    .join('\n');

  const html = `<!doctype html><meta charset="utf-8"><title>${esc(show.title)} — recap review</title>
<style>
  body{background:#0d0d10;color:#eee;font:14px/1.45 -apple-system,sans-serif;margin:24px}
  h1{font-size:22px} h1 small{color:#888;font-weight:400}
  h2{margin:32px 0 8px;font-size:17px} h2 span{color:#888;font-weight:400;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
  .frame .art{position:relative;aspect-ratio:9/16;border-radius:10px;overflow:hidden;background-size:cover;background-position:center top}
  .scrim{position:absolute;inset:0;background:#000}
  .copy{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:10px;background:linear-gradient(transparent 40%,rgba(0,0,0,.75))}
  .kind{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#9ad}
  .title{font-weight:700;margin:2px 0}
  .body{font-size:12px;color:#ddd}
  .meta{font-size:11px;color:#999;padding:4px 2px}
  .audit{font-size:13px;margin:4px 0 12px}
  .audit.ok{color:#7c7} .audit.skip{color:#ca5}
  .audit li.high{color:#f88} .audit li.low{color:#ca5}
  .audit em{color:#999}
</style>
<h1>${esc(show.title)} <small>· ${esc(show.slug)} · through S${show.through_season} of ${show.total_seasons ?? '?'}</small></h1>
<p style="color:#888">Review before upload: does every face match its name, every still belong to its beat, and nothing spoil past its season?</p>
${sections}`;

  await mkdir(WORK, { recursive: true });
  const path = resolve(WORK, `${show.slug}-sheet.html`);
  await writeFile(path, html);
  return path;
}
