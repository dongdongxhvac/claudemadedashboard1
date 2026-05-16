import { useStyle, STYLES, type Style } from '../lib/style';

export function StyleSwitcher() {
  const { style, setStyle } = useStyle();
  return (
    <label className="flex items-center gap-2 t-small t-muted">
      Style
      <select
        value={style}
        onChange={(e) => setStyle(e.target.value as Style)}
        className="border border-gray-300 rounded px-2 py-1 t-small bg-white"
      >
        {STYLES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </label>
  );
}
