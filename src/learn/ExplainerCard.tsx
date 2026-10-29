// One illustrated explainer: plain name, technical name, drawing, one-liner, live example,
// short explanation, formula and related terms. Used by the "?" popover and the Learn page.
import { Icon } from '../guided/icons';
import type { LearnData } from './data';
import { entry, exampleFor, TOPICS } from './glossary';
import type { GlossaryId } from './ids';
import { Illustration } from './illustrations';

export interface ExplainerProps {
  id: GlossaryId;
  data: LearnData;
  compact?: boolean;
  /** heading id for aria-labelledby */
  titleId?: string;
  onRelated?: (id: GlossaryId) => void;
  onMore?: () => void;
  /** show the topic name above the title */
  showTopic?: boolean;
}

export function ExplainerCard({ id, data, compact = false, titleId, onRelated, onMore, showTopic = false }: ExplainerProps) {
  const e = entry(id);
  const ex = exampleFor(id, data);
  const topic = TOPICS.find((t) => t.id === e.topic);
  return (
    <div className={`lv-card-inner${compact ? ' lv-compact' : ''}`}>
      {showTopic && topic && <div className="lv-kicker">{topic.label}</div>}
      <div className="lv-card-head">
        <span className="lv-card-icon" aria-hidden="true">
          <Icon name={e.icon} size={compact ? 18 : 20} />
        </span>
        <div className="lv-card-titles">
          <h3 className="lv-card-title" id={titleId}>
            {e.term}
          </h3>
          <span className="lv-tech">{e.tech}</span>
        </div>
      </div>
      <div className="lv-ill-wrap">
        <Illustration id={e.ill} bundle={data.bundle} result={data.result} compact={compact} focus={e.illFocus} variant={e.illVariant} />
      </div>
      <p className="lv-one">{e.oneLiner}</p>
      {ex && (
        <div className="lv-example">
          <span className="lv-example-tag">
            <Icon name="pulse" size={13} /> From the data
          </span>
          <span>{ex}</span>
        </div>
      )}
      {(compact ? e.body.slice(0, 1) : e.body).map((p, i) => (
        <p key={i} className="lv-body">
          {p}
        </p>
      ))}
      {e.formula && !compact && <code className="lv-formula">{e.formula}</code>}
      {(e.related.length > 0 || onMore) && (
        <div className="lv-related">
          {e.related.length > 0 && <span className="lv-related-label">Related:</span>}
          {e.related.map((r) =>
            onRelated ? (
              <button key={r} type="button" className="lv-rel" onClick={() => onRelated(r)}>
                {entry(r).term}
              </button>
            ) : (
              <span key={r} className="lv-rel lv-rel-static">
                {entry(r).term}
              </span>
            ),
          )}
          {onMore && (
            <button type="button" className="lv-more" onClick={onMore}>
              More in Learn <Icon name="arrowRight" size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
