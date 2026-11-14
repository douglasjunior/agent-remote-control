/** Reads one parameter of the URL fragment (`#a=1&b=2`) and removes it from the address bar, keeping the others. */
export function takeFragmentParam(name: string): string | null {
  const parts = location.hash.replace(/^#/, '').split('&').filter(part => part.length > 0);
  const index = parts.findIndex(part => part.startsWith(`${name}=`));
  if (index < 0) {
    return null;
  }
  const rest = parts.filter((_, position) => position !== index);
  history.replaceState(history.state, '', location.pathname + location.search + (rest.length > 0 ? `#${rest.join('&')}` : ''));
  try {
    return decodeURIComponent(parts[index].slice(name.length + 1));
  } catch {
    return null;
  }
}
