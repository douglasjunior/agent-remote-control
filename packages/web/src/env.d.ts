/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  /** `p2p` in the hosted web app, `server` in the app served by the server. */
  readonly ARC_TARGET: 'p2p' | 'server';
}
