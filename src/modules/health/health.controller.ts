import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  healthCheck() {
    return {
      status: 'ok',
      service: 'remzik-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
