import { Streamdown } from 'streamdown';

import { cn } from '../../lib/utils.js';


const HEADING_CLASSES = '[&_h1]:text-lg [&_h2]:text-base [&_h3]:text-base [&_h4]:text-sm [&_:is(h1,h2,h3,h4)]:mt-4';

/** `isAnimating` marks text still being streamed: only then are unfinished markdown constructs completed. */
export function Markdown({ text, className, isAnimating = false }: {
  readonly text: string;
  readonly className?: string;
  readonly isAnimating?: boolean;
}) {
  return (
    <Streamdown
      className={cn('max-w-none text-sm break-words', HEADING_CLASSES, className)}
      isAnimating={isAnimating}
      parseIncompleteMarkdown={isAnimating}
    >
      {text}
    </Streamdown>
  );
}
