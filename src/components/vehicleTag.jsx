import { topicStyle } from '../lib/topicStyles.js';

export default function VehicleTag({ name }) {
  const style = topicStyle(name);
  return <span className="vehicle-tag" data-vehicle={style.groupKey} title={style.groupLabel} style={{ '--vehicle-color': `var(--vehicle-night, ${style.groupColor})` }}>
    <i aria-hidden="true" /><span>{style.groupLabel}</span>
  </span>;
}
