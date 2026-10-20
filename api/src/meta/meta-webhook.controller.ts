import { BadRequestException, Controller, Get, Headers, Post, Query, Req, Res, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../security/security.decorators.js';
import { MetaWebhookService } from './meta-webhook.service.js';
import { assertValidUtf8Bytes } from '../common/message-text-integrity.js';

@Controller('meta/webhook')
export class MetaWebhookController {
  constructor(private readonly service: MetaWebhookService) {}

  @Public()
  @Get()
  verify(@Query() query: Record<string, string>, @Res() response: Response) {
    const challenge = this.service.verifyChallenge(query);
    return response.status(challenge === null ? 403 : 200).send(challenge ?? '');
  }

  @Public()
  @Post()
  async receive(@Req() request: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string) {
    if (!request.rawBody || !this.service.isValidSignature(request.rawBody, signature)) throw new UnauthorizedException('Assinatura Meta inválida.');
    assertValidUtf8Bytes(request.rawBody);
    try {
      return await this.service.accept(request.body);
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException('Webhook persistido/enfileirado parcialmente; a Meta pode tentar novamente.');
    }
  }
}
