import { BadRequestException } from '@nestjs/common';

export const campaignVariables = [
  'paciente.nome', 'paciente.primeiroNome', 'clinica.nome', 'unidade.nome',
  'atendente.nome', 'agendamento.data', 'agendamento.hora', 'agendamento.procedimento',
] as const;

const allowed = new Set<string>(campaignVariables);
const placeholder = /\{\{\s*([^{}]+?)\s*\}\}/gu;

export function validateCampaignTemplate(body: string) {
  const unknown = [...body.matchAll(placeholder)].map((match) => match[1]!.trim()).filter((key) => !allowed.has(key));
  const remainder = body.replace(placeholder, '');
  if (unknown.length || remainder.includes('{{') || remainder.includes('}}')) {
    throw new BadRequestException(`Variável de campanha inválida: ${unknown[0] ?? 'confira as chaves da mensagem'}.`);
  }
}

export function renderCampaignTemplate(body: string, values: Record<string, string | undefined>) {
  const missing = new Set<string>();
  const rendered = body.replace(placeholder, (token, rawKey: string) => {
    const key = rawKey.trim();
    const value = values[key];
    if (!allowed.has(key) || !value) { missing.add(key); return token; }
    return value;
  });
  return { body: rendered, missing: [...missing] };
}

export function appointmentTemplateValues(startsAt?: Date | null, procedureName?: string | null) {
  return startsAt ? {
    'agendamento.data': new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(startsAt),
    'agendamento.hora': new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(startsAt),
    'agendamento.procedimento': procedureName ?? undefined,
  } : {};
}
