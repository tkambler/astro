import clsx from 'clsx'
import type { ComponentProps } from 'react'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={clsx('ui-input', className)} {...props} />
}
