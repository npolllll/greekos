import type { RgPayload } from '@/lib/modules/display';
import { CATEGORY_RU, CURRENTNESS_RU, attestationLabel, prosodyLabel, regionLabel, registerLabel, riskWarnings } from '@/lib/modules/display';

/** Required Real Greek display: register, context, neutral equivalent, region, attestation, prosody, risk. */
export function RgDetail({ p, full }: { p: RgPayload; full?: boolean }) {
  const risks = riskWarnings(p);
  const prosody = prosodyLabel(p);
  const contexts = p.contexts ?? [];
  return (
    <div>
      <div className="row between">
        <strong className="greek-serif" lang="el" style={{ fontSize: 30 }}>{p.expression}</strong>
        <span className="tag gray">{CATEGORY_RU[p.category ?? ''] ?? p.category ?? ''}</span>
      </div>
      {p.theory_ru ? <p className="small" style={{ color: '#6f6862' }}>{p.theory_ru}</p> : null}
      {risks.length ? <div className="banner warn" role="note"><span><strong>Осторожно.</strong> {risks.join(' ')}</span></div> : null}
      <dl className="rg-fields">
        <div className="rg-field"><dt>Регистр</dt><dd>{registerLabel(p)}</dd></div>
        <div className="rg-field"><dt>Регион</dt><dd>{regionLabel(p)}</dd></div>
        <div className="rg-field"><dt>Подтверждение</dt><dd>{attestationLabel(p)}{p.audience?.currentness ? <div className="tiny muted">{CURRENTNESS_RU[p.audience.currentness] ?? p.audience.currentness}</div> : null}{p.audience?.age_evidence ? <div className="tiny muted">Возраст говорящих: {p.audience.age_evidence.startsWith('unknown') ? 'неизвестно — не маркируем как молодёжный сленг без данных' : p.audience.age_evidence}</div> : null}</dd></div>
        <div className="rg-field"><dt>Интонация</dt><dd>{prosody.text} <span className="code">{prosody.status}</span></dd></div>
      </dl>
      <div className="subtle-divider" />
      {(full ? contexts : contexts.slice(0, 1)).map((c, i) => (
        <div className="dialogue mt8" key={i}>
          <small>{[c.setting, c.relationship].filter(Boolean).join(' · ')}</small>
          {c.example_original ? <p lang="el" style={{ whiteSpace: 'pre-line', marginTop: 8 }}>{c.example_original}</p> : null}
          {c.neutral_alternative ? <small>Нейтральный вариант: <span lang="el" className="greek-serif" style={{ fontSize: 14 }}>{c.neutral_alternative}</span></small> : null}
          {c.pitfall ? <div className="tiny muted mt8">{c.pitfall}</div> : null}
        </div>
      ))}
      {full && p.source_evidence?.length ? (
        <>
          <div className="subtle-divider" />
          <div className="small"><b>Источники</b></div>
          <ul className="rg-sources">
            {p.source_evidence.map((s, i) => (
              <li key={i}>
                {s.url && /^https:\/\//.test(s.url) ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.source_id ?? 'источник'}</a> : s.source_id ?? 'источник'}
                {s.specific_section ? ` · ${s.specific_section}` : ''}{s.publication_date ? ` · ${s.publication_date}` : ' · дата неизвестна'}{s.checked_on ? ` · проверено ${s.checked_on}` : ''}
                {s.limitations ? <div className="tiny muted">Ограничения: {s.limitations}</div> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
