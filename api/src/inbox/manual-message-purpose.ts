import { ForbiddenException } from '@nestjs/common';
import { ConsentPurpose, Prisma } from '@prisma/client';

export const SERVICE_REPLY = 'SERVICE_REPLY';

export async function assertManualMessagePurpose(
  tx: Prisma.TransactionClient,
  tenantId: string,
  patientId: string,
  conversationId: string,
  purpose: ConsentPurpose | typeof SERVICE_REPLY,
): Promise<void> {
  if (purpose === SERVICE_REPLY) {
    const incoming = await tx.message.findFirst({
      where: { tenantId, conversationId, direction: 'INBOUND', actor: 'PATIENT' },
      select: { id: true },
    });
    if (!incoming) throw new ForbiddenException('Resposta ao paciente exige uma mensagem recebida nesta conversa. Para iniciar um contato, escolha a finalidade apropriada.');
    return;
  }

  const consent = await tx.consentPreference.findFirst({
    where: { tenantId, patientId, channel: 'WHATSAPP', purpose, status: 'GRANTED' },
    select: { id: true },
  });
  if (!consent) throw new ForbiddenException('Não há consentimento de WhatsApp registrado para esta finalidade.');
}
