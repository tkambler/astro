import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import clsx from 'clsx'
import type { ComponentProps } from 'react'

const variants = cva('ui-button', {
  variants: {
    variant: { primary: 'ui-button-primary', secondary: 'ui-button-secondary', ghost: 'ui-button-ghost' },
    size: { regular: 'ui-button-regular', compact: 'ui-button-compact' },
  },
  defaultVariants: { variant: 'secondary', size: 'regular' },
})

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof variants> {
  asChild?: boolean
}

export function Button({ asChild = false, className, variant, size, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button'
  return <Component className={clsx(variants({ variant, size }), className)} {...props} />
}
