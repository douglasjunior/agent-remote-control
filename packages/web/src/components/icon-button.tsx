import type { ComponentProps } from 'react';

import { Button } from './ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js';


type IconButtonProps = Omit<ComponentProps<typeof Button>, 'aria-label'> & {
  /** The accessible name and the tooltip text. */
  readonly label: string;
};

/** A button whose content is only an icon: the label names it for screen readers and shows on hover and focus. */
export function IconButton({ label, children, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon" aria-label={label} {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
