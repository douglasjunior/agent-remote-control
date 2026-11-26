import { Button } from '../ui/button.js';

import { useServerSettings } from './server-settings-provider.js';


/** The unsaved changes of the server settings, whichever section holds them, with the buttons that save or drop them. */
export function SettingsSaveBar() {
  const { changes, failure, saving, invalid, save, discard } = useServerSettings();

  if (changes.length === 0 && !failure) {
    return null;
  }
  return (
    <div className="border-t bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
        {failure
          ? <p role="alert" className="min-w-0 text-sm text-destructive">{failure}</p>
          : <p className="text-sm text-muted-foreground">{changes.length === 1 ? '1 unsaved change' : `${changes.length} unsaved changes`}</p>}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" disabled={saving} onClick={discard}>Discard</Button>
          <Button size="sm" disabled={saving || invalid || changes.length === 0} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>
    </div>
  );
}
