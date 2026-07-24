// Renders challenge descriptions (Markdown) to HTML.
//
// The Markdown is our own trusted content, but we still run it through DOMPurify —
// it's cheap defence-in-depth and a good habit whenever you set innerHTML.

import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export default function Markdown({ source }) {
  const html = useMemo(() => {
    const raw = marked.parse(source ?? '', { async: false });
    return DOMPurify.sanitize(raw);
  }, [source]);

  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
