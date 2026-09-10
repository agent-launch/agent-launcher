interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}

/** Minimal toggle switch styled with our tokens. */
export function Switch({ checked, onChange, disabled }: Props) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 disabled:pointer-events-none"
      style={{
        background: checked
          ? 'var(--accent)'
          : 'color-mix(in srgb, var(--text-muted) 28%, transparent)'
      }}
    >
      <span
        className="inline-block size-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  )
}
