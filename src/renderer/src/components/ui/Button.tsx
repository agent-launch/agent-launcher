import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const base =
  'no-drag inline-flex items-center justify-center gap-2 rounded-md font-medium ' +
  'transition-colors disabled:opacity-50 disabled:pointer-events-none select-none'

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--button-primary-base)] text-[var(--button-primary-text)] hover:opacity-90',
  secondary:
    'bg-[var(--button-secondary-base)] text-text-strong border border-border-base hover:border-border-selected',
  ghost: 'text-text-base hover:text-text-strong hover:bg-surface-weak'
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[13px]',
  md: 'h-9 px-4 text-[14px]',
  lg: 'h-11 px-6 text-[15px]'
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest} />
}
