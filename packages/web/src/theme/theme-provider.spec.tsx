import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ThemeToggle } from '../components/theme-toggle.js';

import { useTheme } from './theme-context.js';
import { ThemeProvider } from './theme-provider.js';


type Listener = () => void;

function stubMatchMedia(initialDark: boolean) {
  const listeners = new Set<Listener>();
  const media = {
    matches: initialDark,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    setDark(dark: boolean) {
      media.matches = dark;
      listeners.forEach(listener => listener());
    },
    listenerCount: () => listeners.size,
  };
}

function Probe() {
  const { theme } = useTheme();
  return <span data-testid="theme">{theme}</span>;
}

async function choose(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Theme' }));
  await user.click(await screen.findByRole('menuitemradio', { name }));
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defaults to system and follows the operating system preference', () => {
    const media = stubMatchMedia(false);
    const { unmount } = render(<ThemeProvider><Probe /></ThemeProvider>);

    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(document.documentElement).not.toHaveClass('dark');

    act(() => media.setDark(true));
    expect(document.documentElement).toHaveClass('dark');

    unmount();
    expect(media.listenerCount()).toBe(0);
  });

  it('restores a stored theme and ignores invalid values', () => {
    stubMatchMedia(false);
    localStorage.setItem('arc.theme', 'dark');
    const first = render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
    first.unmount();

    localStorage.setItem('arc.theme', 'neon');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
  });

  it('falls back to system when storage throws', async () => {
    stubMatchMedia(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);

    await choose('Dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it.each([
    ['Light', 'light', false],
    ['Dark', 'dark', true],
  ] as const)('chooses %s from the toggle and persists it', async (label, stored, dark) => {
    stubMatchMedia(!dark);
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);

    await choose(label);

    expect(localStorage.getItem('arc.theme')).toBe(stored);
    expect(document.documentElement.classList.contains('dark')).toBe(dark);
  });

  it('chooses System from the toggle and follows the operating system again', async () => {
    const media = stubMatchMedia(false);
    localStorage.setItem('arc.theme', 'dark');
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    expect(document.documentElement).toHaveClass('dark');

    await choose('System');

    expect(localStorage.getItem('arc.theme')).toBe('system');
    expect(document.documentElement).not.toHaveClass('dark');
    act(() => media.setDark(true));
    expect(document.documentElement).toHaveClass('dark');
  });

  it('throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow('useTheme must be used inside ThemeProvider');
  });
});
