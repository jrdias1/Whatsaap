import { describe, expect, it } from 'vitest';
import { appointmentTemplateValues, renderCampaignTemplate, validateCampaignTemplate } from '../src/campaigns/campaign-template.js';

describe('referências de campanha', () => {
  it('preenche dados disponíveis sem deixar chaves no texto', () => {
    const body = 'Olá, {{paciente.primeiroNome}}! Atendimento em {{unidade.nome}} no dia {{agendamento.data}} às {{agendamento.hora}}.';
    validateCampaignTemplate(body);
    const result = renderCampaignTemplate(body, { 'paciente.primeiroNome': 'Ana', 'unidade.nome': 'Centro', ...appointmentTemplateValues(new Date('2026-10-20T17:00:00.000Z')) });
    expect(result).toEqual({ body: 'Olá, Ana! Atendimento em Centro no dia 20/10/2026 às 14:00.', missing: [] });
  });

  it('identifica dado ausente e rejeita chave desconhecida', () => {
    expect(renderCampaignTemplate('{{agendamento.procedimento}}', {})).toEqual({ body: '{{agendamento.procedimento}}', missing: ['agendamento.procedimento'] });
    expect(() => validateCampaignTemplate('Olá {{paciente.apelido}}')).toThrow();
    expect(() => validateCampaignTemplate('{{paciente.nome}} {{incompleta')).toThrow();
  });
});
