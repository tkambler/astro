import * as SwitchPrimitive from '@radix-ui/react-switch'
import clsx from 'clsx'
import type { ComponentProps } from 'react'

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root className={clsx('ui-switch', className)} {...props}>
    <SwitchPrimitive.Thumb className="ui-switch-thumb" />
  </SwitchPrimitive.Root>
}
