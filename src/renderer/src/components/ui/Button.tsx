import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const base =
  'no-drag inline-flex items-center justify-center gap-1.5 rounded-md font-medium ' +
  'transition-colors duration-150 disabled:opacity-45 disabled:pointer-events-none select-none'

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--button-primary-base)] text-[var(--button-primary-text)] hover:brightness-110',
  secondary:
    'bg-[var(--button-secondary-base)] text-text-strong border border-border-base ' +
    'hover:border-border-selected hover:bg-surface-hover',
  ghost: 'text-text-base hover:text-text-strong hover:bg-selection'
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[13px]',
  md: 'h-8 px-3.5 text-[13px]',
  lg: 'h-10 px-5 text-[14px]'
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest} />
}
