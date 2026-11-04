import { useCallback, useEffect, useRef, useState } from 'react';


const STICK_THRESHOLD_PX = 24;

/**
 * Keeps a scroll viewport pinned to its end while its content grows, until the reader scrolls up.
 * Content growth is observed with a ResizeObserver because the virtualized list reports its new height
 * only after the items are measured.
 */
export function useStickToEnd(viewport: HTMLElement | null) {
  const stickToEnd = useRef(true);
  const lastScrollTop = useRef(0);
  const [atEnd, setAtEnd] = useState(true);

  const scrollToEnd = useCallback((behavior: ScrollBehavior) => {
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior });
  }, [viewport]);

  const follow = useCallback(() => {
    stickToEnd.current = true;
    setAtEnd(true);
    scrollToEnd('auto');
  }, [scrollToEnd]);

  useEffect(() => {
    if (!viewport) {
      return undefined;
    }
    const handleScroll = () => {
      const scrolledUp = viewport.scrollTop < lastScrollTop.current;
      lastScrollTop.current = viewport.scrollTop;
      if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= STICK_THRESHOLD_PX) {
        stickToEnd.current = true;
      } else if (scrolledUp) {
        stickToEnd.current = false;
      }
      setAtEnd(stickToEnd.current);
    };
    viewport.addEventListener('scroll', handleScroll);

    const content = viewport.firstElementChild;
    const observer = new ResizeObserver(() => {
      if (stickToEnd.current) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
      }
    });
    if (content) {
      observer.observe(content);
    }

    return () => {
      viewport.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [viewport]);

  return { atEnd, follow, scrollToEnd };
}
