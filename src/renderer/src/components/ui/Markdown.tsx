import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Render markdown (GitHub-flavored) for transcript text. Styling lives in the
 * `.md` rules in styles/index.css. Links force target=_blank so Electron routes
 * them through setWindowOpenHandler (OS browser) instead of navigating the app.
 */
export function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
