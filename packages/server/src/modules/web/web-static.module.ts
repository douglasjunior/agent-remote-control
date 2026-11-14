import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'node:path';


/** Routes the server answers itself; every other GET falls back to the web app's `index.html`. */
const SERVER_ROUTES = ['/health', '/ws'];

@Module({
  imports: [
    ServeStaticModule.forRootAsync({
      useFactory: () => {
        const directory = process.env.WEB_STATIC_DIR?.trim();
        return directory ? [{ rootPath: resolve(directory), exclude: SERVER_ROUTES }] : [];
      },
    }),
  ],
})
export class WebStaticModule {}
