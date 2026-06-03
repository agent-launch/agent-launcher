import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

/**
 * Render markdown (GitHub-flavored) for transcript text. Code blocks get
 * highlight.js `hljs-*` classes via rehype-highlight; the palette is theme-aware
 * (see the `--syntax-*` tokens + `.hljs-*` rules in styles). Styling lives in
 * the `.md` rules in styles/index.css. Links force target=_blank so Electron
 * routes them through setWindowOpenHandler (OS browser) instead of navigating.
 */
export function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
