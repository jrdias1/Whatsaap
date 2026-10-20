import { BadRequestException, Controller, Headers, Param, Post, Body, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../security/security.decorators.js';
import { EvolutionWebhookService } from './evolution-webhook.service.js';

@Controller('evolution/webhook')
export class EvolutionWebhookController {
  constructor(private readonly service: EvolutionWebhookService) {}
  @Public()
  @Post(':connectionId')
  async receive(@Param('connectionId') connectionId: string, @Headers('x-evolution-webhook-secret') secret: string | undefined, @Body() body: unknown, @Req() request: RawBodyRequest<Request>) {
    try { return await this.service.accept(connectionId, secret, body, request.rawBody); }
    catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException('Evento autenticado foi persistido ou o Redis falhou; Evolution pode repetir o webhook.');
    }
  }
}
