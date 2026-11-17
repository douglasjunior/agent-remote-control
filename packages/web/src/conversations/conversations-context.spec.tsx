import { render } from '@testing-library/react';

import { useConversations } from './conversations-context.js';


function Probe() {
  useConversations();
  return null;
}

describe('useConversations', () => {
  it('should throw outside the provider', () => {
    rs.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useConversations must be used inside ConversationsProvider');
    rs.restoreAllMocks();
  });
});
