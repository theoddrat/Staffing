// KaTeX formula renderer (display or inline). Renders an error string instead of throwing.
import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export default function Formula({ tex, block = true }: { tex: string; block?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: block, throwOnError: false, strict: 'ignore' });
    } catch (e) {
      return `<code>${String(e)}</code>`;
    }
  }, [tex, block]);
  return <span className={block ? 'formula formula-block' : 'formula'} dangerouslySetInnerHTML={{ __html: html }} />;
}
