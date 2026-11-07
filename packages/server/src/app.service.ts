import { Injectable } from '@nestjs/common';


@Injectable()
export class AppService {
  getHealth(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
