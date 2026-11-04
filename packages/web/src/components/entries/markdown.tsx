import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import { cn } from '../../lib/utils.js';


export function Markdown({ text, className }: { readonly text: string; readonly className?: string }) {
  return (
    <div className={cn('prose-sm max-w-none break-words [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2 [&_ul]:list-disc [&_ul]:pl-5', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{text}</ReactMarkdown>
    </div>
  );
}
