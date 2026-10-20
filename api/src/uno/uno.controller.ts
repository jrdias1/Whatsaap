import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Put,
  Get,
} from '@nestjs/common';
import { Public, Roles } from '../security/security.decorators.js';
import { UnoService } from './uno.service.js';

@Controller('integrations/uno')
export class UnoController {
  constructor(private readonly service: UnoService) {}
  @Get(':unitId/status') status(@Param('unitId') unitId: string) {
    return this.service.status(unitId);
  }
  @Get(':unitId') @Roles('TENANT_ADMIN') get(@Param('unitId') unitId: string) {
    return this.service.get(unitId);
  }
  @Put(':unitId') @Roles('TENANT_ADMIN') configure(
    @Param('unitId') unitId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.configure(unitId, body);
  }
  @Post(':unitId/test') @Roles('TENANT_ADMIN') test(
    @Param('unitId') unitId: string,
  ) {
    return this.service.test(unitId);
  }
  @Post('webhook/:connectionId') @Public() webhook(
    @Param('connectionId') connectionId: string,
    @Headers('x-uno-webhook-token') header: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.webhook(connectionId, header, body);
  }
}
