import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant
  size?: Size
}

const base =
  'no-drag inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium ' +
  'shadow-[0_1px_1px_rgba(0,0,0,0.04)] transition-[background,border-color,color,box-shadow,filter,transform] duration-150 ' +
  'disabled:pointer-events-none disabled:opacity-45 active:translate-y-px select-none'

const variants: Record<Variant, string> = {
  primary:
    'border border-transparent bg-[var(--button-primary-base)] text-[var(--button-primary-text)] ' +
    'hover:brightness-105 hover:shadow-[0_2px_5px_rgba(0,0,0,0.16)]',
  secondary:
    'bg-[var(--button-secondary-base)] text-text-strong border border-border-base ' +
    'hover:border-border-selected hover:bg-surface',
  ghost:
    'border border-transparent text-text-base shadow-none hover:text-text-strong hover:bg-selection'
}

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[13px]',
  md: 'h-8 px-3.5 text-[13px]',
  lg: 'h-10 px-5 text-[14px]'
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest} />
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: LinkProps) {
  return <a className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest} />
}
