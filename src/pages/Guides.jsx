import { useMemo, useState } from 'react';
import { useApi } from '../lib/useApi.js';
import { Link } from '../lib/router.jsx';
import { PageHeader, Spinner, ErrorBox, Empty, Badge } from '../components/ui.jsx';
import { Icon } from '../components/Icon.jsx';
import { parseMarkdown, parseInline } from '../../shared/markdown.js';

const CATEGORY_ICON = { 'Start & Organisation': 'check', Steuern: 'euro', 'Werbung & Recht': 'shield', Agentur: 'briefcase' };

/** Übersicht aller Leitfäden. base = '/leitfaeden' (Team) oder '/wissen' (Creator) */
export function GuidesPage({ base = '/leitfaeden', title = 'Leitfäden', subtitle }) {
  const { data, error, loading, reload } = useApi('/guides');
  const [term, setTerm] = useState('');
  const items = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (data?.items || []).filter((g) => !t || `${g.title} ${g.summary} ${g.category}`.toLowerCase().includes(t));
  }, [data, term]);

  if (loading && !data) return <Spinner label="Leitfäden werden geladen…" />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={subtitle || 'Kurz erklärt, was man schnell vergisst – zum Nachlesen und als PDF.'}
        actions={
          <div className="guide-search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Leitfaden suchen…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Leitfaden suchen" />
          </div>
        }
      />
      {!items.length && <Empty icon="book" title="Nichts gefunden" text={`Kein Leitfaden passt zu „${term}“.`} />}
      {data.categories.map((cat) => {
        const list = items.filter((g) => g.category === cat);
        if (!list.length) return null;
        return (
          <section key={cat} className="guide-section">
            <h2 className="guide-section-title"><Icon name={CATEGORY_ICON[cat] || 'book'} size={16} /> {cat}</h2>
            <div className="guide-grid">
              {list.map((g) => (
                <Link key={g.slug} to={`${base}/${g.slug}`} className="guide-card">
                  <div className="guide-card-title">{g.title}</div>
                  <div className="guide-card-text">{g.summary}</div>
                  <div className="guide-card-meta">
                    <span>{g.minutes} Min.</span>
                    {g.has_pdf && <span className="guide-card-pdf"><Icon name="download" size={13} /> PDF</span>}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function GuideViewPage({ params, base = '/leitfaeden', backLabel = 'Alle Leitfäden' }) {
  const { data, error, loading, reload } = useApi(`/guides/${encodeURIComponent(params.slug)}`);
  const blocks = useMemo(() => (data ? parseMarkdown(data.guide.body) : []), [data]);
  if (loading && !data) return <Spinner label="Leitfaden wird geladen…" />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const g = data.guide;
  return (
    <div className="page guide-page">
      <PageHeader
        back={{ to: base, label: backLabel }}
        title={g.title}
        subtitle={g.summary}
        actions={g.has_pdf && (
          <a className="btn btn-primary btn-md" href={`/api/guides/${g.slug}/pdf`} download>
            <Icon name="download" size={16} /> Als PDF herunterladen
          </a>
        )}
      />
      <div className="guide-meta">
        <Badge tone="gray">{g.category}</Badge>
        <span>Stand {g.updated}</span>
        <span>ca. {g.minutes} Min. Lesezeit</span>
      </div>
      <article className="guide-body">
        <Blocks blocks={blocks} />
        <p className="guide-disclaimer">{data.disclaimer}</p>
      </article>
      {g.has_pdf && (
        <div className="guide-foot">
          <a className="btn btn-secondary btn-md" href={`/api/guides/${g.slug}/pdf`} download><Icon name="download" size={16} /> PDF herunterladen</a>
          <Link to={base} className="btn btn-ghost btn-md">{backLabel}</Link>
        </div>
      )}
    </div>
  );
}

function Inline({ text }) {
  return parseInline(text).map((s, i) =>
    s.bold !== undefined ? <strong key={i}>{s.bold}</strong>
      : s.link !== undefined ? <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="link">{s.link}</a>
      : <span key={i}>{s.text}</span>
  );
}

const NOTE_LABEL = { tip: 'Tipp', warn: 'Achtung', info: 'Gut zu wissen' };
const NOTE_ICON = { tip: 'sparkle', warn: 'alert', info: 'note' };

function Blocks({ blocks }) {
  return blocks.map((b, i) => {
    if (b.t === 'h2') return <h2 key={i}><Inline text={b.text} /></h2>;
    if (b.t === 'h3') return <h3 key={i}><Inline text={b.text} /></h3>;
    if (b.t === 'p') return <p key={i}><Inline text={b.text} /></p>;
    if (b.t === 'ul') return <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>;
    if (b.t === 'ol') return <ol key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ol>;
    if (b.t === 'note') {
      return (
        <div key={i} className={`guide-note guide-note-${b.kind}`}>
          <div className="guide-note-label"><Icon name={NOTE_ICON[b.kind]} size={14} /> {NOTE_LABEL[b.kind]}</div>
          <Blocks blocks={b.blocks} />
        </div>
      );
    }
    if (b.t === 'table') {
      return (
        <div key={i} className="table-wrap guide-table">
          <table className="table">
            <thead><tr>{b.head.map((h, j) => <th key={j}><Inline text={h} /></th>)}</tr></thead>
            <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Inline text={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    return null;
  });
}

