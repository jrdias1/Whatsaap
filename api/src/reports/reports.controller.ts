import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../security/security.decorators.js';
import { ReportsService } from './reports.service.js';

@Controller('reports')
@Roles('TENANT_ADMIN', 'UNIT_MANAGER')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('overview') overview(@Query() query: { from?: string; to?: string; unitId?: string }) { return this.reports.overview(query); }

  @Get('export.csv') async exportCsv(@Query() query: { from?: string; to?: string; unitId?: string }, @Res() response: Response) {
    const csv = await this.reports.exportCsv(query);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="relatorio-clinico.csv"');
    response.setHeader('Cache-Control', 'no-store');
    response.send(csv);
  }

  @Get('nps/settings') settings() { return this.reports.npsSettings(); }
  @Put('nps/settings') @Roles('TENANT_ADMIN') saveSettings(@Body() body: Record<string, unknown>) { return this.reports.saveNpsSettings(body); }
  @Get('nps/surveys') surveys(@Query() query: { from?: string; to?: string; unitId?: string; status?: string; page?: string; pageSize?: string }) { return this.reports.npsSurveys(query); }
  @Post('nps/surveys/:id/response') @Roles('TENANT_ADMIN', 'UNIT_MANAGER') recordResponse(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.reports.recordNpsResponse(id, body); }
}
