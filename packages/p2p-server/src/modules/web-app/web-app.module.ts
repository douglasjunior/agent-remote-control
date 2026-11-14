import { SIGNALING_CLIENT_PATH, SIGNALING_HOST_PATH } from '@agent-remote-control/protocol/signaling';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'node:path';


/** Routes the server answers itself; every other GET falls back to the web app's `index.html`. */
const SERVER_ROUTES = ['/health', SIGNALING_HOST_PATH, SIGNALING_CLIENT_PATH];

/** Serves the build of `packages/web` made for remote access (`dist-p2p`), from `P2P_WEB_DIR`. */
@Module({
  imports: [
    ServeStaticModule.forRootAsync({
      useFactory: () => {
        const directory = process.env.P2P_WEB_DIR?.trim();
        return directory ? [{ rootPath: resolve(directory), exclude: SERVER_ROUTES }] : [];
      },
    }),
  ],
})
export class WebAppModule {}
