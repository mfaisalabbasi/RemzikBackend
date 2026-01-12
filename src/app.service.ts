import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Thanks Almighty, Step to word New world';
  }
}
