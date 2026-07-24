// A single per-topic progress bar for the dashboard.

const TOPIC_LABELS = {
  'syntax-variables': 'Syntax & Variables',
  'control-flow': 'Control Flow',
  lists: 'Lists',
  loops: 'Loops',
  functions: 'Functions',
  strings: 'Strings',
  dictionaries: 'Dictionaries',
  files: 'Files',
  classes: 'Classes',
  mixed: 'Mixed Challenges',
};

export default function TopicBar({ topic, solved, total, percent }) {
  return (
    <div className="topic-bar">
      <div className="label">
        <span>{TOPIC_LABELS[topic] ?? topic}</span>
        <span className="muted">
          {solved}/{total}
        </span>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
