import { topicStyle, TOPIC_DASHES } from '../lib/topicStyles.js';

export default function TopicSwatch({ name }) {
  const style = topicStyle(name);
  return <svg className="topic-swatch" viewBox="0 0 36 12" aria-hidden="true" style={{ color: `var(--source-ink, ${style.color})`, '--source-night': style.nightColor }}>
    <line x1="1" y1="6" x2="35" y2="6" strokeDasharray={TOPIC_DASHES[style.pattern]?.join(' ')} />
  </svg>;
}
