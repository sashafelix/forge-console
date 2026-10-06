import { useMemo, useState } from 'react';
export function parseDiff(text: string): { path: string; lines: string[] }[] {
  const files: { path: string; lines: string[] }[] = [];
  let file: { path: string; lines: string[] } | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('--- ')) { file = { path: line.slice(4).replace(/^a\//,''), lines: [line] }; files.push(file); }
    else if (file) { file.lines.push(line); if (line.startsWith('+++ ') && line !== '+++ /dev/null') file.path = line.slice(4).replace(/^b\//,''); }
  }
  return files;
}
export function DiffViewer({ text, truncated }: { text: string; truncated: boolean }) {
  const files = useMemo(() => parseDiff(text), [text]);
  const [selected, setSelected] = useState('');
  const file = files.find((f) => f.path === selected) ?? files[0];
  if (!file) return <p>No text diff is available in this evidence bundle.</p>;
  return <div className="forge-diff-layout">
    <nav aria-label="Changed files">{files.map((f) => <button type="button" aria-current={f === file ? 'page' : undefined} key={f.path} onClick={() => setSelected(f.path)}>{f.path}</button>)}</nav>
    <div><h3>{file.path}</h3>{truncated && <p role="status">This preview is bounded. Review the complete diff in the local run folder.</p>}
      <pre className="forge-diff" aria-label={'Diff for ' + file.path}>{file.lines.slice(0,2000).map((line,i) =>
        <span key={i} className={line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}>{line || ' '}{'\n'}</span>)}</pre>
    </div>
  </div>;
}
