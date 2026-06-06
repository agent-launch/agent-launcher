import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const base =
  'no-drag inline-flex items-center justify-center gap-2 rounded-lg font-medium ' +
  'transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none select-none ' +
  'active:scale-[0.98]'

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--button-primary-base)] text-[var(--button-primary-text)] shadow-sm ' +
    'hover:brightness-110 hover:shadow-md',
  secondary:
    'bg-[var(--button-secondary-base)] text-text-strong border border-border-base ' +
    'shadow-[var(--shadow-sm)] hover:border-border-selected hover:bg-surface',
  ghost: 'text-text-base hover:text-text-strong hover:bg-surface-weak'
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-3 text-[13px]',
  md: 'h-9 px-4 text-[14px]',
  lg: 'h-11 px-6 text-[15px]'
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest} />
}
