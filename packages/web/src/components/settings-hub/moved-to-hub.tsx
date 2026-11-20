import { Navigate, useLocation } from 'react-router';

import { SETTINGS_PATH } from './settings-paths.js';


/** Sends an address of the pages the hub replaced (`/skills/api-testing`) to the same path inside the hub. */
export function MovedToHub() {
  const { pathname, search, hash, state } = useLocation();
  return <Navigate to={{ pathname: `${SETTINGS_PATH}${pathname}`, search, hash }} replace state={state} />;
}
