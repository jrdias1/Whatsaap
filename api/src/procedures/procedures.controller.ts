import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ProceduresService } from './procedures.service.js';
import { Roles } from '../security/security.decorators.js';

@Controller('procedures')
export class ProceduresController {
  constructor(private readonly procedures: ProceduresService) {}
  @Get() list() { return this.procedures.list(); }
  @Post() @Roles('TENANT_ADMIN') create(@Body() body: Record<string, unknown>) { return this.procedures.create(body); }
  @Patch(':id') @Roles('TENANT_ADMIN') update(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.procedures.update(id, body); }
}
