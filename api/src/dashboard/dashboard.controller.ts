import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get('overview') overview(@Query('unitId') unitId?: string) { return this.dashboard.overview(unitId); }
}
