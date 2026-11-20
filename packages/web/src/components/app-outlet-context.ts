import { useOutletContext } from 'react-router';


/** What `AppLayout` offers the page it renders. */
export type AppOutletContext = {
  /** Opens the conversation list (the docked panel or the drawer) and moves the focus into it. */
  readonly showConversations: () => void;
};

export function useAppOutlet(): AppOutletContext {
  return useOutletContext<AppOutletContext>();
}
