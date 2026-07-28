import { Children, isValidElement, memo, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'
import { useT } from '@/i18n'

type MarkdownProps = Parameters<typeof ReactMarkdown>[0]

const remarkPlugins: MarkdownProps['remarkPlugins'] = [remarkGfm]
const rehypePlugins: MarkdownProps['rehypePlugins'] = [
  [rehypeHighlight, { detect: true, ignoreMissing: true }]
]
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  pre: CodeBlock
}

function textFromNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textFromNode).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children)
  return Children.toArray(node).map(textFromNode).join('')
}

function CodeBlock({
  node: _node,
  children,
  ...props
}: React.ComponentProps<'pre'> & { node?: unknown }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const code = textFromNode(children)

  return (
    <div className="md-codeblock">
      <button
        type="button"
        className="md-codeblock-copy"
        title={copied ? t('chat.copied') : t('chat.copy')}
        aria-label={copied ? t('chat.copied') : t('chat.copy')}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          } catch {
            /* clipboard unavailable */
          }
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre {...props}>{children}</pre>
    </div>
  )
}

/**
 * Render markdown (GitHub-flavored) for transcript text. Code blocks get
 * highlight.js `hljs-*` classes via rehype-highlight; the palette is theme-aware
 * (see the `--syntax-*` tokens + `.hljs-*` rules in styles). Styling lives in
 * the `.md` rules in styles/index.css. Links force target=_blank so Electron
 * routes them through setWindowOpenHandler (OS browser) instead of navigating.
 */
export const Markdown = memo(function Markdown({
  children,
  className = ''
}: {
  children: string
  className?: string
}) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
