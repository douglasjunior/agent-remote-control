import { useOutletContext } from 'react-router';


/** What `AppLayout` offers the page it renders. */
export type AppOutletContext = {
  /** Whether the conversation list is on screen beside the page: docked and open. */
  readonly conversationListVisible: boolean;
  /** Opens the conversation list: the docked panel or the drawer. */
  readonly showConversations: () => void;
};

export function useAppOutlet(): AppOutletContext {
  return useOutletContext<AppOutletContext>();
}
