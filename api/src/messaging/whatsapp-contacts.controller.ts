import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../security/security.decorators.js';
import { MessagingConnectionsService } from './messaging-connections.service.js';

@Controller('messaging/contacts')
@Roles('TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR')
export class WhatsappContactsController {
  constructor(private readonly connections: MessagingConnectionsService) {}

  @Get('whatsapp')
  listWhatsappContacts(@Query('unitId') unitId = '') {
    return this.connections.whatsappContacts(unitId);
  }
}
